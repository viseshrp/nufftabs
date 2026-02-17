// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeSettings, writeSettings, readSettings, STORAGE_KEYS, type SettingsInput, DEFAULT_SETTINGS } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

describe('storage_utils_coverage', () => {
  let mockChrome: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    mockChrome = createMockChrome();
    setMockChrome(mockChrome.chrome);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('normalizeSettings', () => {
    it('handles null or invalid settings object', () => {
      expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings('invalid')).toEqual(DEFAULT_SETTINGS);
    });

    it('handles partial settings with googleDriveBackup', () => {
      const input = {
        excludePinned: false,
        googleDriveBackup: {
          enabled: true,
          // Missing other fields, should use defaults
        }
      };
      const result = normalizeSettings(input);
      expect(result.excludePinned).toBe(false);
      expect(result.googleDriveBackup.enabled).toBe(true);
      expect(result.googleDriveBackup.filename).toBe(DEFAULT_SETTINGS.googleDriveBackup.filename);
      expect(result.googleDriveBackup.mode).toBe(DEFAULT_SETTINGS.googleDriveBackup.mode);
      expect(result.googleDriveBackup.lastSync).toBe(DEFAULT_SETTINGS.googleDriveBackup.lastSync);
    });

    it('handles googleDriveBackup with invalid types', () => {
      const input = {
        googleDriveBackup: {
          enabled: 'not-a-boolean',
          filename: '', // empty string
          mode: 'invalid-mode',
          lastSync: 'not-a-number'
        }
      };
      const result = normalizeSettings(input);
      expect(result.googleDriveBackup.enabled).toBe(DEFAULT_SETTINGS.googleDriveBackup.enabled);
      expect(result.googleDriveBackup.filename).toBe(DEFAULT_SETTINGS.googleDriveBackup.filename);
      expect(result.googleDriveBackup.mode).toBe(DEFAULT_SETTINGS.googleDriveBackup.mode);
      expect(result.googleDriveBackup.lastSync).toBe(DEFAULT_SETTINGS.googleDriveBackup.lastSync);
    });
  });

  describe('writeSettings', () => {
    it('updates only provided fields (partial update)', async () => {
        // Setup initial state
        const initial = { ...DEFAULT_SETTINGS, excludePinned: true, restoreBatchSize: 50 };
        await mockChrome.chrome.storage.local.set({ [STORAGE_KEYS.settings]: initial });

        const update: SettingsInput = {
            excludePinned: false,
            // restoreBatchSize omitted
        };

        await writeSettings(update);

        const stored = await readSettings();
        expect(stored.excludePinned).toBe(false);
        expect(stored.restoreBatchSize).toBe(50); // Should remain unchanged
    });

    it('updates nested googleDriveBackup fields partially', async () => {
        const initial = {
            ...DEFAULT_SETTINGS,
            googleDriveBackup: { enabled: false, filename: 'old.json', mode: 'overwrite' as const, lastSync: 100 }
        };
        await mockChrome.chrome.storage.local.set({ [STORAGE_KEYS.settings]: initial });

        const update: SettingsInput = {
            googleDriveBackup: {
                enabled: true
                // filename, mode, lastSync omitted
            }
        };

        await writeSettings(update);

        const stored = await readSettings();
        expect(stored.googleDriveBackup.enabled).toBe(true);
        expect(stored.googleDriveBackup.filename).toBe('old.json');
        expect(stored.googleDriveBackup.lastSync).toBe(100);
    });

    it('removes restoreBatchSize if invalid', async () => {
        const initial = { ...DEFAULT_SETTINGS, restoreBatchSize: 50 };
        await mockChrome.chrome.storage.local.set({ [STORAGE_KEYS.settings]: initial });

        // Pass 0 (invalid)
        await writeSettings({ restoreBatchSize: 0 });

        const stored = await mockChrome.chrome.storage.local.get(STORAGE_KEYS.settings);
        const raw = stored[STORAGE_KEYS.settings] as any;
        expect(raw.restoreBatchSize).toBeUndefined();
    });
  });
});
