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
    <input id="driveRetentionCount" type="number" />
    <table><tbody id="driveBackupList"></tbody></table>
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

  it('renders fallback backups and surfaces auth/retention errors', async () => {
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

    mock.chrome.tabs.create = async () => {
      throw new Error('cannot open tab');
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

    const backupTable = document.querySelector<HTMLTableSectionElement>('#driveBackupList');
    expect(backupTable?.textContent).toContain('2 KB');

    const openAuth = document.querySelector<HTMLButtonElement>('#openDriveAuth');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!openAuth || !driveStatus) {
      throw new Error('Missing Drive controls');
    }

    openAuth.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('Failed to open Drive auth page.'));

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

  it('shows backup auth errors and supports restore actions', async () => {
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
    const restoreButton = document.querySelector<HTMLButtonElement>('button[data-action="restore-backup"]');
    const driveStatus = document.querySelector<HTMLDivElement>('#driveStatus');
    if (!backupNow || !restoreButton || !driveStatus) {
      throw new Error('Missing Drive controls');
    }

    backupNow.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('auth denied'));

    restoreButton.click();
    await waitForCondition(() => (driveStatus.textContent ?? '').includes('auth denied'));

    interactiveAuthFails = false;
    restoreButton.click();
    await waitForCondition(() => {
      const text = driveStatus.textContent ?? '';
      return text.includes('Restore completed') || text.includes('Connected.');
    });
  });
});
