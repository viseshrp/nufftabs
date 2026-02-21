// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSettingsPage } from '../../entrypoints/options/settings_page';
import { DRIVE_STORAGE_KEYS } from '../../entrypoints/drive/types';
import { STORAGE_KEYS } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

async function waitForCondition(predicate: () => boolean, cycles = 80): Promise<void> {
  for (let index = 0; index < cycles; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition did not become true in expected microtask cycles.');
}

function mountSettingsDom(): void {
  document.body.innerHTML = `
    <input id="excludePinned" type="checkbox" />
    <input id="restoreBatchSize" type="number" />
    <input id="discardRestoredTabsDisabled" type="radio" name="discardRestoredTabs" value="false" />
    <input id="discardRestoredTabsEnabled" type="radio" name="discardRestoredTabs" value="true" />
    <input id="themeOs" type="radio" name="theme" value="os" />
    <input id="themeLight" type="radio" name="theme" value="light" />
    <input id="themeDark" type="radio" name="theme" value="dark" />
    <button id="openDriveAuth" type="button">Connect to Google Drive</button>
    <button id="backupNow" type="button">Backup now</button>
    <button id="openDriveRestore" type="button">Restore from backup</button>
    <input id="driveRetentionCount" type="number" />
    <dialog id="driveRestoreDialog">
      <button id="closeDriveRestore" type="button">Close</button>
      <table><tbody id="driveBackupList"></tbody></table>
      <button id="loadMoreDriveBackups" type="button">Load more backups</button>
    </dialog>
    <div id="driveStatus"></div>
    <div id="status"></div>
  `;
}

describe('drive backup integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('backs up from options Drive section', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
        [STORAGE_KEYS.savedTabsIndex]: ['g1'],
        'savedTabs:g1': [{ id: '1', url: 'https://example.com', title: 'Example', savedAt: 1 }],
        [DRIVE_STORAGE_KEYS.installId]: 'install-1',
        [DRIVE_STORAGE_KEYS.driveBackupIndex]: {
          installId: 'install-1',
          backups: [
            {
              fileId: 'seed-file',
              fileName: 'backup-seed-g1.json',
              timestamp: 1700000000000,
              size: 12,
              tabGroupCount: 1,
            },
          ],
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (details, callback) => {
      delete mock.chrome.runtime.lastError;
      if (!details.interactive) {
        callback('token-1');
        return;
      }
      callback('token-1');
    };

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.includes('/drive/v3/files?') && url.includes('mimeType')) {
        return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (method === 'GET' && url.includes('/drive/v3/files?')) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: 'new-file',
                name: 'backup-2024-01-02T00-00-00-000Z-g1.json',
                createdTime: '2024-01-02T00:00:00.000Z',
                size: '100',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      if (method === 'POST' && url.includes('/upload/drive/v3/files')) {
        return new Response(
          JSON.stringify({
            id: 'new-file',
            name: 'backup-uploaded.json',
            createdTime: '2024-01-02T00:00:00.000Z',
            size: '100',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    mountSettingsDom();

    await initSettingsPage(document);

    const backupNow = document.querySelector<HTMLButtonElement>('#backupNow');
    if (!backupNow) {
      throw new Error('Missing backup now button');
    }
    backupNow.click();
    await waitForCondition(() => {
      const backupIndex = mock.storageData[DRIVE_STORAGE_KEYS.driveBackupIndex] as
        | { backups?: Array<{ fileId: string }> }
        | undefined;
      return backupIndex?.backups?.[0]?.fileId === 'new-file';
    });

    const backupIndex = mock.storageData[DRIVE_STORAGE_KEYS.driveBackupIndex] as {
      backups: Array<{ fileId: string }>;
    };
    expect(backupIndex.backups[0]?.fileId).toBe('new-file');

    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    await waitForCondition(() => {
      const message = driveStatus?.textContent ?? '';
      return message.includes('Backup completed') || message.includes('Connected.');
    });
  });

  it('shows nothing-to-backup message and skips upload when no groups exist', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    const fetchMock = vi.fn(async (_input: string | URL) => new Response(JSON.stringify({ files: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    mountSettingsDom();
    await initSettingsPage(document);

    const backupNow = document.querySelector<HTMLButtonElement>('#backupNow');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!backupNow || !driveStatus) {
      throw new Error('Missing backup controls');
    }

    backupNow.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Nothing to backup.'));

    const uploadCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/upload/drive/v3/files'));
    expect(uploadCalls).toHaveLength(0);
  });

  it('keeps restore disabled when disconnected and surfaces auth/retention errors', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (details, callback) => {
      if (!details.interactive) {
        delete mock.chrome.runtime.lastError;
        callback(undefined);
        return;
      }
      mock.chrome.runtime.lastError = { message: 'auth denied' };
      callback(undefined);
    };

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/drive/v3/files?') && url.includes('mimeType')) {
        return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url.includes('/drive/v3/files?')) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: 'fallback-file',
                name: 'backup-fallback-g4.json',
                createdTime: '2024-01-02T00:00:00.000Z',
                size: '2048',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    mountSettingsDom();
    await initSettingsPage(document);

    const openAuth = document.querySelector<HTMLButtonElement>('#openDriveAuth');
    const backupNow = document.querySelector<HTMLButtonElement>('#backupNow');
    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openAuth || !backupNow || !openRestore || !driveStatus) {
      throw new Error('Missing Drive controls');
    }
    expect(backupNow.disabled).toBe(true);
    expect(openRestore.disabled).toBe(true);
    expect(openAuth.textContent).toContain('Connect to Google Drive');

    openAuth.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('auth denied'));

    const originalSet = mock.chrome.storage.local.set;
    mock.chrome.storage.local.set = async (payload) => {
      if (Object.hasOwn(payload, DRIVE_STORAGE_KEYS.retentionCount)) {
        throw new Error('retention failed');
      }
      await originalSet(payload);
    };

    const retentionInput = document.querySelector<HTMLInputElement>('#driveRetentionCount');
    if (!retentionInput) {
      throw new Error('Missing retention input');
    }
    retentionInput.value = '8';
    retentionInput.dispatchEvent(new Event('change'));

    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Failed to save retention setting.'));
  });

  it('loads fallback backups while connected and supports in-page disconnect', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (details, callback) => {
      delete mock.chrome.runtime.lastError;
      if (!details.interactive) {
        callback('token-1');
        return;
      }
      callback('token-1');
    };

    const removeCachedAuthToken = vi.fn((details: chrome.identity.InvalidTokenDetails, callback?: () => void) => {
      callback?.();
      return details;
    });
    mock.chrome.identity.removeCachedAuthToken = removeCachedAuthToken;

    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.includes('/drive/v3/files?') && url.includes('mimeType')) {
        return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'GET' && url.includes('/drive/v3/files?')) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: 'fallback-file',
                name: 'backup-fallback-g4.json',
                createdTime: '2024-01-02T00:00:00.000Z',
                size: '2048',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    mountSettingsDom();
    await initSettingsPage(document);

    const backupNow = document.querySelector<HTMLButtonElement>('#backupNow');
    const openAuth = document.querySelector<HTMLButtonElement>('#openDriveAuth');
    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    const restoreDialog = document.querySelector<HTMLDialogElement>('#driveRestoreDialog');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!backupTable || !backupNow || !openAuth || !openRestore || !restoreDialog || !driveStatus) {
      throw new Error('Missing Drive controls');
    }

    expect(backupNow.disabled).toBe(false);
    expect(openRestore.disabled).toBe(false);
    expect(openAuth.textContent).toContain('Connected to Google Drive');

    openRestore.click();
    await waitForCondition(() => backupTable.textContent?.includes('2 KB') ?? false);
    expect(restoreDialog.open).toBe(true);

    openAuth.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Disconnected from Google Drive.'));
    expect(removeCachedAuthToken).toHaveBeenCalledOnce();
    expect(backupNow.disabled).toBe(true);
    expect(openRestore.disabled).toBe(true);
    expect(openAuth.textContent).toContain('Connect to Google Drive');
  });

  it('connects in-page from disconnected state and enables backup action', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (details, callback) => {
      delete mock.chrome.runtime.lastError;
      if (!details.interactive) {
        callback(undefined);
        return;
      }
      callback('token-connected');
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 })));

    mountSettingsDom();
    await initSettingsPage(document);

    const openAuth = document.querySelector<HTMLButtonElement>('#openDriveAuth');
    const backupNow = document.querySelector<HTMLButtonElement>('#backupNow');
    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openAuth || !backupNow || !openRestore || !driveStatus) {
      throw new Error('Missing Drive controls');
    }

    expect(backupNow.disabled).toBe(true);
    expect(openRestore.disabled).toBe(true);
    openAuth.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Connected to Google Drive.'));
    expect(openAuth.textContent).toContain('Connected to Google Drive');
    expect(backupNow.disabled).toBe(false);
    expect(openRestore.disabled).toBe(false);
  });

  it('shows disconnect error messaging and handles visibility refresh events', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };
    mock.chrome.identity.removeCachedAuthToken = () => {
      throw new Error('disconnect-failed');
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('/drive/v3/files?') && url.includes('mimeType')) {
          return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (method === 'GET' && url.includes('/drive/v3/files?')) {
          return new Response(JSON.stringify({ files: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('', { status: 200 });
      }),
    );

    mountSettingsDom();
    await initSettingsPage(document);

    const openAuth = document.querySelector<HTMLButtonElement>('#openDriveAuth');
    const retentionInput = document.querySelector<HTMLInputElement>('#driveRetentionCount');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openAuth || !retentionInput || !driveStatus) {
      throw new Error('Missing Drive controls');
    }

    retentionInput.value = '9';
    retentionInput.dispatchEvent(new Event('change'));
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Retention saved: keep latest 9 backups.'));

    document.dispatchEvent(new Event('visibilitychange'));
    await waitForCondition(() => openAuth.textContent?.includes('Connected to Google Drive') ?? false);

    openAuth.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('disconnect-failed'));
  });

  it('loads empty restore list into modal and supports explicit modal close', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && url.includes('/drive/v3/files?') && url.includes('mimeType')) {
          return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (method === 'GET' && url.includes('/drive/v3/files?')) {
          return new Response(JSON.stringify({ files: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('', { status: 200 });
      }),
    );

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const closeRestore = document.querySelector<HTMLButtonElement>('#closeDriveRestore');
    const restoreDialog = document.querySelector<HTMLDialogElement>('#driveRestoreDialog');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openRestore || !closeRestore || !restoreDialog || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    const showModalMock = vi.fn(() => {
      restoreDialog.setAttribute('open', '');
    });
    const closeModalMock = vi.fn(() => {
      restoreDialog.removeAttribute('open');
    });
    restoreDialog.showModal = showModalMock as unknown as HTMLDialogElement['showModal'];
    restoreDialog.close = closeModalMock as unknown as HTMLDialogElement['close'];

    openRestore.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('No backups found.'));
    expect(showModalMock).toHaveBeenCalledOnce();
    expect(restoreDialog.open).toBe(true);

    closeRestore.click();
    expect(closeModalMock).toHaveBeenCalledOnce();
    expect(restoreDialog.open).toBe(false);
  });

  it('loads restore backups lazily with explicit load-more action', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/drive/v3/files?') && url.includes('mimeType')) {
        return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/drive/v3/files?') && url.includes('pageToken=token-2')) {
        return new Response(
          JSON.stringify({
            files: [{ id: 'f3', name: 'backup-third-g2.json', createdTime: '2024-01-03T00:00:00.000Z', size: '30' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      if (url.includes('/drive/v3/files?')) {
        return new Response(
          JSON.stringify({
            files: [
              { id: 'f1', name: 'backup-first-g1.json', createdTime: '2024-01-01T00:00:00.000Z', size: '10' },
              { id: 'f2', name: 'backup-second-g1.json', createdTime: '2024-01-02T00:00:00.000Z', size: '20' },
            ],
            nextPageToken: 'token-2',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const loadMore = document.querySelector<HTMLButtonElement>('#loadMoreDriveBackups');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openRestore || !loadMore || !backupTable || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(
      () => backupTable.querySelectorAll('button[data-action="restore-backup"]').length === 2,
    );
    expect(loadMore.hidden).toBe(false);
    expect(loadMore.disabled).toBe(false);

    loadMore.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Loaded all 3 backups.'));
    expect(backupTable.querySelectorAll('button[data-action="restore-backup"]').length).toBe(3);
    expect(loadMore.hidden).toBe(true);

    const downloadCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('alt=media'));
    expect(downloadCalls).toHaveLength(0);
  });

  it('loads restore list interactively even when no cached token exists yet', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (details, callback) => {
      if (!details.interactive) {
        delete mock.chrome.runtime.lastError;
        callback(undefined);
        return;
      }
      delete mock.chrome.runtime.lastError;
      callback('token-interactive');
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('/drive/v3/files?') && url.includes('mimeType')) {
          return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/drive/v3/files?')) {
          return new Response(
            JSON.stringify({
              files: [{ id: 'f1', name: 'backup-first-g1.json', createdTime: '2024-01-01T00:00:00.000Z', size: '10' }],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openRestore || !backupTable || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    // Dispatch manually so we can exercise the handler path even while the disabled state is shown.
    openRestore.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Choose a backup to restore.'));
    expect(backupTable.querySelectorAll('button[data-action="restore-backup"]').length).toBe(1);
  });

  it('keeps load-more visible when additional backup pages remain', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('/drive/v3/files?') && url.includes('mimeType')) {
          return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/drive/v3/files?') && url.includes('pageToken=token-2')) {
          return new Response(
            JSON.stringify({
              files: [{ id: 'f2', name: 'backup-second-g1.json', createdTime: '2024-01-02T00:00:00.000Z', size: '20' }],
              nextPageToken: 'token-3',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (url.includes('/drive/v3/files?')) {
          return new Response(
            JSON.stringify({
              files: [{ id: 'f1', name: 'backup-first-g1.json', createdTime: '2024-01-01T00:00:00.000Z', size: '10' }],
              nextPageToken: 'token-2',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const loadMore = document.querySelector<HTMLButtonElement>('#loadMoreDriveBackups');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openRestore || !loadMore || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => loadMore.hidden === false && loadMore.disabled === false);
    loadMore.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Loaded 2 backups.'));
    expect(loadMore.hidden).toBe(false);
    expect(loadMore.disabled).toBe(false);
  });

  it('shows load-more failure status when a backup page request fails', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('/drive/v3/files?') && url.includes('mimeType')) {
          return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/drive/v3/files?') && url.includes('pageToken=token-2')) {
          return new Response('boom', { status: 500 });
        }
        if (url.includes('/drive/v3/files?')) {
          return new Response(
            JSON.stringify({
              files: [{ id: 'f1', name: 'backup-first-g1.json', createdTime: '2024-01-01T00:00:00.000Z', size: '10' }],
              nextPageToken: 'token-2',
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const loadMore = document.querySelector<HTMLButtonElement>('#loadMoreDriveBackups');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openRestore || !loadMore || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => loadMore.hidden === false && loadMore.disabled === false);
    loadMore.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Drive list files failed (500): boom'));
  });

  it('handles restore-list auth errors when restore is triggered without connection state', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (details, callback) => {
      if (details.interactive) {
        mock.chrome.runtime.lastError = { message: 'auth denied' };
        callback(undefined);
        return;
      }
      delete mock.chrome.runtime.lastError;
      callback(undefined);
    };

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ files: [] }), { status: 200 })));

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openRestore || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    // Dispatch directly to exercise the handler's auth-error branch even while the disabled state is set.
    openRestore.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('auth denied'));
  });

  it('shows backup auth errors and restores from the on-demand restore modal', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          theme: 'os',
        },
        [DRIVE_STORAGE_KEYS.driveBackupIndex]: {
          installId: 'install-1',
          backups: [
            {
              fileId: 'seed-file',
              fileName: 'backup-seed-g1.json',
              timestamp: 1700000000000,
              size: 12,
              tabGroupCount: 1,
            },
          ],
        },
      },
    });
    setMockChrome(mock.chrome);

    let interactiveAuthFails = true;
    mock.chrome.identity.getAuthToken = (details, callback) => {
      if (details.interactive && interactiveAuthFails) {
        mock.chrome.runtime.lastError = { message: 'auth denied' };
        callback(undefined);
        return;
      }
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/drive/v3/files?') && url.includes('mimeType')) {
        return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/drive/v3/files?')) {
        return new Response(
          JSON.stringify({
            files: [
              {
                id: 'seed-file',
                name: 'backup-seed-g1.json',
                createdTime: '2024-01-02T00:00:00.000Z',
                size: '12',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      if (url.includes('alt=media')) {
        return new Response(
          JSON.stringify({
            savedTabs: {
              restored: [{ id: '1', url: 'https://restored.com', title: 'Restored', savedAt: 1 }],
            },
            settings: {
              excludePinned: false,
              restoreBatchSize: 25,
              discardRestoredTabs: true,
              theme: 'dark',
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    mountSettingsDom();
    await initSettingsPage(document);

    const backupNow = document.querySelector<HTMLButtonElement>('#backupNow');
    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    const restoreDialog = document.querySelector<HTMLDialogElement>('#driveRestoreDialog');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!backupNow || !openRestore || !backupTable || !restoreDialog || !driveStatus) {
      throw new Error('Missing Drive controls');
    }

    backupNow.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('auth denied'));

    openRestore.click();
    await waitForCondition(() => (restoreDialog.open && (backupTable.textContent ?? '').includes('Restore')) || false);
    const restoreButton = backupTable.querySelector<HTMLButtonElement>('button[data-action="restore-backup"]');
    if (!restoreButton) {
      throw new Error('Missing restore row button');
    }

    restoreButton.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('auth denied'));

    interactiveAuthFails = false;
    restoreButton.click();
    await waitForCondition(() => {
      const text = driveStatus.textContent ?? '';
      return text.includes('Restore completed') || text.includes('Connected');
    });
  });
});
