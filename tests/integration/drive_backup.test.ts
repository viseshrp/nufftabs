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
    <input id="duplicateTabsAllow" type="radio" name="duplicateTabsPolicy" value="allow" />
    <input id="duplicateTabsReject" type="radio" name="duplicateTabsPolicy" value="reject" />
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
      <select id="driveRestorePageSize">
        <option value="5" selected>5</option>
        <option value="10">10</option>
        <option value="15">15</option>
        <option value="20">20</option>
      </select>
      <button id="previousDriveBackupsPage" type="button">Previous</button>
      <button id="nextDriveBackupsPage" type="button">Next</button>
    </dialog>
    <div id="snackbar" class="snackbar"></div>
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
          duplicateTabsPolicy: 'allow',
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

    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
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
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!backupNow || !driveStatus) {
      throw new Error('Missing backup controls');
    }

    backupNow.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Nothing to backup.'));

    const uploadCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/upload/drive/v3/files'));
    expect(uploadCalls).toHaveLength(0);
  });

  it('merges a Drive backup into existing tab lists without replacing them', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'reject',
          theme: 'os',
        },
        [STORAGE_KEYS.savedTabsIndex]: ['existing', 'shared'],
        'savedTabs:existing': [{ id: '1', url: 'https://existing.com', title: 'Existing', savedAt: 1 }],
        'savedTabs:shared': [{ id: '2', url: 'https://shared-existing.com', title: 'Shared Existing', savedAt: 2 }],
        [DRIVE_STORAGE_KEYS.installId]: 'install-1',
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback(details.interactive ? 'token-1' : 'token-1');
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
                id: 'backup-1',
                name: 'backup-2024-01-02T00-00-00-000Z-g2.json',
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
      if (url.includes('alt=media')) {
        return new Response(
          JSON.stringify({
            savedTabs: {
              shared: [
                { id: '3', url: 'https://shared-existing.com', title: 'Duplicate Shared', savedAt: 3 },
                { id: '4', url: 'https://shared-new.com', title: 'Shared New', savedAt: 4 },
              ],
              restored: [{ id: '5', url: 'https://restored.com', title: 'Restored', savedAt: 5 }],
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

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !backupTable || !driveStatus) {
      throw new Error('Missing Drive restore controls');
    }

    openRestore.click();
    await waitForCondition(() => backupTable.querySelectorAll('button[data-action="merge-backup"]').length === 1);

    const mergeButton = backupTable.querySelector<HTMLButtonElement>('button[data-action="merge-backup"]');
    if (!mergeButton) {
      throw new Error('Missing merge row button');
    }

    mergeButton.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Merge completed.'));

    const savedIndex = mock.storageData[STORAGE_KEYS.savedTabsIndex] as string[];
    expect(savedIndex).toEqual(['existing', 'shared', 'restored']);

    const existingGroup = mock.storageData['savedTabs:existing'] as Array<{ url: string }>;
    expect(existingGroup).toHaveLength(1);

    const sharedGroup = mock.storageData['savedTabs:shared'] as Array<{ url: string }>;
    expect(sharedGroup).toHaveLength(2);
    expect(sharedGroup[0]?.url).toBe('https://shared-existing.com');
    expect(sharedGroup[1]?.url).toBe('https://shared-new.com');

    const restoredGroup = mock.storageData['savedTabs:restored'] as Array<{ url: string }>;
    expect(restoredGroup).toHaveLength(1);
    expect(restoredGroup[0]?.url).toBe('https://restored.com');

    const savedSettings = mock.storageData[STORAGE_KEYS.settings] as { restoreBatchSize: number; theme: string };
    expect(savedSettings.restoreBatchSize).toBe(100);
    expect(savedSettings.theme).toBe('os');
  });

  it('keeps restore disabled when disconnected and surfaces auth/retention errors', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
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
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
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
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
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
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
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
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
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

  it('loads restore backups lazily with explicit next/previous page actions', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
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
    const previousPage = document.querySelector<HTMLButtonElement>('#previousDriveBackupsPage');
    const nextPage = document.querySelector<HTMLButtonElement>('#nextDriveBackupsPage');
    const restorePageSize = document.querySelector<HTMLSelectElement>('#driveRestorePageSize');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !previousPage || !nextPage || !restorePageSize || !backupTable || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    restorePageSize.value = '5';
    openRestore.click();
    await waitForCondition(
      () => backupTable.querySelectorAll('button[data-action="restore-backup"]').length === 2,
    );
    expect(previousPage.disabled).toBe(true);
    expect(nextPage.disabled).toBe(false);
    const initialListCalls = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      return url.includes('/drive/v3/files?') && !url.includes('mimeType');
    });
    expect(initialListCalls).toHaveLength(1);
    expect(String(initialListCalls[0]?.[0])).toContain('pageSize=5');

    nextPage.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Showing 1 backup on this page.'));
    expect(backupTable.querySelectorAll('button[data-action="restore-backup"]').length).toBe(1);
    expect(previousPage.disabled).toBe(false);
    expect(nextPage.disabled).toBe(true);

    previousPage.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Showing 2 backups on this page.'));
    expect(backupTable.querySelectorAll('button[data-action="restore-backup"]').length).toBe(2);
    expect(previousPage.disabled).toBe(true);
    expect(nextPage.disabled).toBe(false);

    const downloadCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('alt=media'));
    expect(downloadCalls).toHaveLength(0);
    const listCalls = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      return url.includes('/drive/v3/files?') && !url.includes('mimeType');
    });
    expect(listCalls).toHaveLength(3);
    expect(String(listCalls[0]?.[0])).toContain('pageSize=5');
    expect(String(listCalls[1]?.[0])).toContain('pageSize=5');
    expect(String(listCalls[2]?.[0])).toContain('pageSize=5');
  });

  it('replaces visible rows immediately when restore page size selection changes', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    const createFiles = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `f${index + 1}`,
        name: `backup-${index + 1}-g1.json`,
        createdTime: `2024-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
        size: String(10 + index),
      }));

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/drive/v3/files?') && url.includes('mimeType')) {
        return new Response(JSON.stringify({ files: [{ id: 'folder-1' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/drive/v3/files?') && url.includes('pageSize=10')) {
        return new Response(JSON.stringify({ files: createFiles(10) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/drive/v3/files?') && url.includes('pageSize=5')) {
        return new Response(JSON.stringify({ files: createFiles(5) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const restorePageSize = document.querySelector<HTMLSelectElement>('#driveRestorePageSize');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    if (!openRestore || !restorePageSize || !backupTable) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => backupTable.querySelectorAll('button[data-action="restore-backup"]').length === 5);

    restorePageSize.value = '10';
    restorePageSize.dispatchEvent(new Event('change'));
    await waitForCondition(() => backupTable.querySelectorAll('button[data-action="restore-backup"]').length === 10);

    restorePageSize.value = '5';
    restorePageSize.dispatchEvent(new Event('change'));
    await waitForCondition(() => backupTable.querySelectorAll('button[data-action="restore-backup"]').length === 5);

    const listCalls = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      return url.includes('/drive/v3/files?') && !url.includes('mimeType');
    });
    expect(listCalls).toHaveLength(3);
    expect(String(listCalls[0]?.[0])).toContain('pageSize=5');
    expect(String(listCalls[1]?.[0])).toContain('pageSize=10');
    expect(String(listCalls[2]?.[0])).toContain('pageSize=5');
  });

  it('deletes a backup from restore modal without downloading backup payload', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
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
              { id: 'f1', name: 'backup-first-g1.json', createdTime: '2024-01-01T00:00:00.000Z', size: '10' },
              { id: 'f2', name: 'backup-second-g1.json', createdTime: '2024-01-02T00:00:00.000Z', size: '20' },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      if (method === 'DELETE' && url.includes('/drive/v3/files/f1')) {
        return new Response('', { status: 204 });
      }
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !backupTable || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => backupTable.querySelectorAll('button[data-action="delete-backup"]').length === 2);
    await waitForCondition(() => {
      const deleteActionButton = backupTable.querySelector<HTMLButtonElement>(
        'button[data-action="delete-backup"][data-file-id="f1"]',
      );
      return deleteActionButton !== null && deleteActionButton.disabled === false;
    });

    const deleteButton = backupTable.querySelector<HTMLButtonElement>('button[data-action="delete-backup"][data-file-id="f1"]');
    if (!deleteButton) {
      throw new Error('Missing delete button');
    }
    deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitForCondition(() =>
      fetchMock.mock.calls.some((call) => {
        const url = String(call[0]);
        const init = call[1] as RequestInit | undefined;
        return url.includes('/drive/v3/files/f1') && (init?.method ?? 'GET') === 'DELETE';
      }),
    );

    const deleteCalls = fetchMock.mock.calls.filter((call) => {
      const url = String(call[0]);
      const init = call[1] as RequestInit | undefined;
      return url.includes('/drive/v3/files/f1') && (init?.method ?? 'GET') === 'DELETE';
    });
    expect(deleteCalls).toHaveLength(1);

    const downloadCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('alt=media'));
    expect(downloadCalls).toHaveLength(0);
  });

  it('surfaces delete errors from restore modal', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
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
        if (method === 'DELETE' && url.includes('/drive/v3/files/f1')) {
          return new Response('nope', { status: 500 });
        }
        return new Response('', { status: 200 });
      }),
    );

    mountSettingsDom();
    await initSettingsPage(document);

    const openRestore = document.querySelector<HTMLButtonElement>('#openDriveRestore');
    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !backupTable || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => backupTable.querySelectorAll('button[data-action="delete-backup"]').length === 1);
    await waitForCondition(() => {
      const deleteActionButton = backupTable.querySelector<HTMLButtonElement>(
        'button[data-action="delete-backup"][data-file-id="f1"]',
      );
      return deleteActionButton !== null && deleteActionButton.disabled === false;
    });

    const deleteButton = backupTable.querySelector<HTMLButtonElement>('button[data-action="delete-backup"][data-file-id="f1"]');
    if (!deleteButton) {
      throw new Error('Missing delete button');
    }
    deleteButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Drive delete file failed (500): nope'));
  });

  it('loads restore list interactively even when no cached token exists yet', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !backupTable || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    // Dispatch manually so we can exercise the handler path even while the disabled state is shown.
    openRestore.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Showing 1 backup on this page.'));
    expect(backupTable.querySelectorAll('button[data-action="restore-backup"]').length).toBe(1);
  });

  it('keeps next enabled when additional backup pages remain', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
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
    const previousPage = document.querySelector<HTMLButtonElement>('#previousDriveBackupsPage');
    const nextPage = document.querySelector<HTMLButtonElement>('#nextDriveBackupsPage');
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !previousPage || !nextPage || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => nextPage.disabled === false && previousPage.disabled === true);
    nextPage.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Showing 1 backup on this page.'));
    expect(previousPage.disabled).toBe(false);
    expect(nextPage.disabled).toBe(false);
  });

  it('shows next-page failure status when a backup page request fails', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
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
    const nextPage = document.querySelector<HTMLButtonElement>('#nextDriveBackupsPage');
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !nextPage || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => nextPage.disabled === false);
    nextPage.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Drive list files failed (500): boom'));
  });

  it('shows previous-page failure status when back navigation request fails', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    let firstPageRequests = 0;
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
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
        if (url.includes('/drive/v3/files?')) {
          firstPageRequests += 1;
          if (firstPageRequests >= 2) {
            return new Response('prev-boom', { status: 500 });
          }
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
    const previousPage = document.querySelector<HTMLButtonElement>('#previousDriveBackupsPage');
    const nextPage = document.querySelector<HTMLButtonElement>('#nextDriveBackupsPage');
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !previousPage || !nextPage || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => nextPage.disabled === false && previousPage.disabled === true);
    nextPage.click();
    await waitForCondition(() => previousPage.disabled === false);
    previousPage.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Drive list files failed (500): prev-boom'));
  });

  it('shows page-size update failure status when resize request fails', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
          theme: 'os',
        },
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback('token-1');
    };

    let listRequestCount = 0;
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
          listRequestCount += 1;
          if (listRequestCount >= 2) {
            return new Response('resize-boom', { status: 500 });
          }
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
    const restorePageSize = document.querySelector<HTMLSelectElement>('#driveRestorePageSize');
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
    if (!openRestore || !restorePageSize || !driveStatus) {
      throw new Error('Missing restore controls');
    }

    openRestore.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Showing 1 backup on this page.'));

    restorePageSize.value = '10';
    restorePageSize.dispatchEvent(new Event('change'));
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Drive list files failed (500): resize-boom'));
  });

  it('handles restore-list auth errors when restore is triggered without connection state', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          restoreBatchSize: 100,
          discardRestoredTabs: false,
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
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
          duplicateTabsPolicy: 'allow',
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
    const driveStatus = document.querySelector<HTMLDivElement>('#snackbar');
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

    const savedSettings = mock.storageData[STORAGE_KEYS.settings] as { restoreBatchSize: number; theme: string };
    expect(savedSettings.restoreBatchSize).toBe(100);
    expect(savedSettings.theme).toBe('os');
  });
});
