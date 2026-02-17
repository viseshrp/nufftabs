import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  normalizeSettings,
  writeSettings,
  type Settings,
  type SettingsInput,
} from '../shared/storage';
import { logExtensionError } from '../shared/utils';

export function setStatus(statusEl: HTMLDivElement | null, message: string): void {
  if (statusEl) statusEl.textContent = message;
}

export function getBatchSizeInput(input: HTMLInputElement): number | null {
  const rawValue = input.value.trim();
  if (rawValue.length === 0) return null;
  const rawNumber = Number(rawValue);
  if (!Number.isFinite(rawNumber)) return null;
  const parsed = Math.floor(rawNumber);
  return parsed > 0 ? parsed : null;
}

export async function initSettingsPage(documentRef: Document = document): Promise<void> {
  const excludePinnedEl = documentRef.querySelector<HTMLInputElement>('#excludePinned');
  const restoreBatchSizeEl = documentRef.querySelector<HTMLInputElement>('#restoreBatchSize');
  const discardRadios = Array.from(
    documentRef.querySelectorAll<HTMLInputElement>('input[name="discardRestoredTabs"]'),
  );
  const themeRadios = Array.from(
    documentRef.querySelectorAll<HTMLInputElement>('input[name="theme"]'),
  );
  const statusEl = documentRef.querySelector<HTMLDivElement>('#status');
  const googleDriveEnabledEl = documentRef.querySelector<HTMLInputElement>('#googleDriveEnabled');
  const googleDriveFilenameEl = documentRef.querySelector<HTMLInputElement>('#googleDriveFilename');
  const googleDriveModeRadios = Array.from(
    documentRef.querySelectorAll<HTMLInputElement>('input[name="googleDriveMode"]'),
  );
  const configureAuthBtn = documentRef.querySelector<HTMLButtonElement>('#configureAuthBtn');

  if (!excludePinnedEl || !restoreBatchSizeEl || discardRadios.length === 0 || themeRadios.length === 0) return;

  const setDiscardRadios = (enabled: boolean) => {
    for (const radio of discardRadios) {
      radio.checked = radio.value === String(enabled);
    }
  };

  const setGoogleDriveModeRadios = (mode: 'overwrite' | 'new') => {
    for (const radio of googleDriveModeRadios) {
      radio.checked = radio.value === mode;
    }
  };

  const setThemeRadios = (theme: Settings['theme']) => {
    for (const radio of themeRadios) {
      radio.checked = radio.value === theme;
    }
  };

  const getDiscardSelection = () => {
    const selected = discardRadios.find((radio) => radio.checked);
    return selected?.value === 'true';
  };

  const getGoogleDriveModeSelection = (): 'overwrite' | 'new' => {
    const selected = googleDriveModeRadios.find((radio) => radio.checked);
    return selected?.value === 'new' ? 'new' : 'overwrite';
  };

  const getThemeSelection = (): Settings['theme'] => {
    const selected = themeRadios.find((radio) => radio.checked);
    const val = selected?.value;
    if (val === 'light' || val === 'dark') return val;
    return 'os';
  };

  const applyTheme = (theme: Settings['theme']) => {
    if (theme === 'os') {
      documentRef.documentElement.removeAttribute('data-theme');
    } else {
      documentRef.documentElement.setAttribute('data-theme', theme);
    }
  };

  const getRestoreBatchSizeSetting = () => {
    const parsed = getBatchSizeInput(restoreBatchSizeEl);
    return parsed ?? undefined;
  };
  const raw = await chrome.storage.local.get([STORAGE_KEYS.settings]);
  const rawSettings = raw[STORAGE_KEYS.settings];
  const hasCustomBatchSize =
    rawSettings &&
    typeof rawSettings === 'object' &&
    typeof (rawSettings as { restoreBatchSize?: unknown }).restoreBatchSize === 'number' &&
    Number.isFinite((rawSettings as { restoreBatchSize?: unknown }).restoreBatchSize);

  let settings: Settings = normalizeSettings(rawSettings);
  excludePinnedEl.checked = settings.excludePinned;
  restoreBatchSizeEl.value = hasCustomBatchSize ? String(settings.restoreBatchSize) : '';
  setDiscardRadios(settings.discardRestoredTabs);
  setThemeRadios(settings.theme);
  if (googleDriveEnabledEl) googleDriveEnabledEl.checked = settings.googleDriveBackup.enabled;
  if (googleDriveFilenameEl) googleDriveFilenameEl.value = settings.googleDriveBackup.filename;
  setGoogleDriveModeRadios(settings.googleDriveBackup.mode);
  applyTheme(settings.theme);

  let customBatchSize = hasCustomBatchSize;

  const saveSettings = async (nextSettings: SettingsInput) => {
    const saved = await writeSettings(nextSettings);
    if (!saved) {
      excludePinnedEl.checked = settings.excludePinned;
      restoreBatchSizeEl.value = customBatchSize ? String(settings.restoreBatchSize) : '';
      setDiscardRadios(settings.discardRestoredTabs);
      setThemeRadios(settings.theme);
      if (googleDriveEnabledEl) googleDriveEnabledEl.checked = settings.googleDriveBackup.enabled;
      if (googleDriveFilenameEl) googleDriveFilenameEl.value = settings.googleDriveBackup.filename;
      setGoogleDriveModeRadios(settings.googleDriveBackup.mode);
      applyTheme(settings.theme);
      setStatus(statusEl, 'Failed to save settings.');
      return;
    }
    settings = {
      excludePinned: nextSettings.excludePinned,
      restoreBatchSize:
        typeof nextSettings.restoreBatchSize === 'number' && Number.isFinite(nextSettings.restoreBatchSize)
          ? Math.floor(nextSettings.restoreBatchSize)
          : DEFAULT_SETTINGS.restoreBatchSize,
      discardRestoredTabs:
        typeof nextSettings.discardRestoredTabs === 'boolean'
          ? nextSettings.discardRestoredTabs
          : DEFAULT_SETTINGS.discardRestoredTabs,
      theme: nextSettings.theme ?? settings.theme,
      googleDriveBackup: {
        enabled: nextSettings.googleDriveBackup?.enabled ?? settings.googleDriveBackup.enabled,
        filename: nextSettings.googleDriveBackup?.filename ?? settings.googleDriveBackup.filename,
        mode: nextSettings.googleDriveBackup?.mode ?? settings.googleDriveBackup.mode,
        lastSync: nextSettings.googleDriveBackup?.lastSync ?? settings.googleDriveBackup.lastSync,
      },
    };
    customBatchSize =
      typeof nextSettings.restoreBatchSize === 'number' && Number.isFinite(nextSettings.restoreBatchSize);
    applyTheme(settings.theme);
    setStatus(statusEl, 'Settings saved.');
  };

  const updateSettings = async () => {
    const nextSettings: SettingsInput = {
      excludePinned: excludePinnedEl.checked,
      restoreBatchSize: getRestoreBatchSizeSetting(),
      discardRestoredTabs: getDiscardSelection(),
      theme: getThemeSelection(),
      googleDriveBackup: {
        enabled: googleDriveEnabledEl?.checked,
        filename: googleDriveFilenameEl?.value,
        mode: getGoogleDriveModeSelection(),
      },
    };
    await saveSettings(nextSettings);
    // Explicitly clear invalid input if parsing failed (returned undefined)
    if (!nextSettings.restoreBatchSize) {
      restoreBatchSizeEl.value = '';
    }
  };

  const runUpdate = () => {
    void updateSettings().catch((error) => {
      logExtensionError('Failed to update settings from options UI', error, { operation: 'runtime_context' });
    });
  };

  excludePinnedEl.addEventListener('change', () => {
    runUpdate();
  });

  restoreBatchSizeEl.addEventListener('change', () => {
    runUpdate();
  });

  restoreBatchSizeEl.addEventListener('blur', () => {
    runUpdate();
  });

  for (const radio of discardRadios) {
    radio.addEventListener('change', () => {
      runUpdate();
    });
  }

  for (const radio of themeRadios) {
    radio.addEventListener('change', () => {
      runUpdate();
    });
  }

  googleDriveEnabledEl?.addEventListener('change', runUpdate);
  googleDriveFilenameEl?.addEventListener('change', runUpdate);
  googleDriveFilenameEl?.addEventListener('blur', runUpdate);
  for (const radio of googleDriveModeRadios) {
    radio.addEventListener('change', runUpdate);
  }

  configureAuthBtn?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('auth.html') });
  });
}
