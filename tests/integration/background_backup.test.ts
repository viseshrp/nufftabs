// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockChrome, setMockChrome, setMockDefineBackground } from '../helpers/mock_chrome';

const mockAuthenticate = vi.fn();
const mockUploadFile = vi.fn();

vi.mock('../../entrypoints/shared/google_drive', () => ({
  authenticate: mockAuthenticate,
  uploadFile: mockUploadFile,
  getProfileUserInfo: vi.fn(),
  clearCachedToken: vi.fn(),
  findFile: vi.fn(),
}));

describe('background backup', () => {
  let mockChrome: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    mockChrome = createMockChrome();
    setMockChrome(mockChrome.chrome);

    // Mock chrome.identity
    Object.assign(mockChrome.chrome, {
      identity: {
        getAuthToken: vi.fn(),
        removeCachedAuthToken: vi.fn(),
      },
    });

    // Mock fetch globally
    vi.stubGlobal('fetch', vi.fn());

    mockAuthenticate.mockReset().mockResolvedValue('mock-token');
    mockUploadFile.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('triggers backup when saved tabs change', async () => {
    let backgroundCallback: (() => void) | undefined;
    setMockDefineBackground((callback) => {
        backgroundCallback = callback;
    });

    // Import background script to register listeners
    await import('../../entrypoints/background/index');
    if (backgroundCallback) backgroundCallback();

    // Enable backup in settings
    await mockChrome.chrome.storage.local.set({
        settings: {
            excludePinned: true,
            restoreBatchSize: 100,
            discardRestoredTabs: false,
            theme: 'os',
            googleDriveBackup: {
                enabled: true,
                filename: 'backup.json',
                mode: 'overwrite',
                lastSync: 0
            }
        }
    });

    // Mock saved tabs (this triggers storage.onChanged)
    await mockChrome.chrome.storage.local.set({
        savedTabsIndex: ['group1'],
        'savedTabs:group1': [{ url: 'http://example.com' }]
    });

    // Advance timers to trigger debounced function
    await vi.advanceTimersByTimeAsync(6000);

    expect(mockAuthenticate).toHaveBeenCalledWith(false);
    expect(mockUploadFile).toHaveBeenCalledWith(
      'mock-token',
      expect.stringContaining('http://example.com'),
      'backup.json',
      'overwrite',
    );
  });

  it('does not trigger backup if disabled', async () => {
    let backgroundCallback: (() => void) | undefined;
    setMockDefineBackground((callback) => {
        backgroundCallback = callback;
    });

    await import('../../entrypoints/background/index');
    if (backgroundCallback) backgroundCallback();

    // Disable backup in settings
    await mockChrome.chrome.storage.local.set({
        settings: {
            excludePinned: true,
            restoreBatchSize: 100,
            discardRestoredTabs: false,
            theme: 'os',
            googleDriveBackup: {
                enabled: false,
                filename: 'backup.json',
                mode: 'overwrite',
                lastSync: 0
            }
        }
    });

    // Mock saved tabs
    await mockChrome.chrome.storage.local.set({
        savedTabsIndex: ['group1'],
        'savedTabs:group1': [{ url: 'http://example.com' }]
    });

    await vi.advanceTimersByTimeAsync(6000);

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });
});
