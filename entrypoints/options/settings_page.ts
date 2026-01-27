import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  normalizeSettings,
  writeSettings,
  type Settings,
  type SettingsInput,
} from '../shared/storage';

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
  const statusEl = documentRef.querySelector<HTMLDivElement>('#status');

  if (!excludePinnedEl || !restoreBatchSizeEl || discardRadios.length === 0) return;

  const setDiscardRadios = (enabled: boolean) => {
    for (const radio of discardRadios) {
      radio.checked = radio.value === String(enabled);
    }
  };

  const getDiscardSelection = () => {
    const selected = discardRadios.find((radio) => radio.checked);
    return selected?.value === 'true';
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

  let customBatchSize = hasCustomBatchSize;

  const saveSettings = async (nextSettings: SettingsInput) => {
    const saved = await writeSettings(nextSettings);
    if (!saved) {
      excludePinnedEl.checked = settings.excludePinned;
      restoreBatchSizeEl.value = customBatchSize ? String(settings.restoreBatchSize) : '';
      setDiscardRadios(settings.discardRestoredTabs);
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
    };
    customBatchSize =
      typeof nextSettings.restoreBatchSize === 'number' && Number.isFinite(nextSettings.restoreBatchSize);
    setStatus(statusEl, 'Settings saved.');
  };

  excludePinnedEl.addEventListener('change', async () => {
    const nextSettings: SettingsInput = {
      excludePinned: excludePinnedEl.checked,
      restoreBatchSize: getRestoreBatchSizeSetting(),
      discardRestoredTabs: getDiscardSelection(),
    };
    await saveSettings(nextSettings);
  });

  const handleBatchSizeChange = async () => {
    const parsed = getBatchSizeInput(restoreBatchSizeEl);
    if (!parsed) {
      const nextSettings: SettingsInput = {
        excludePinned: excludePinnedEl.checked,
        restoreBatchSize: undefined,
        discardRestoredTabs: getDiscardSelection(),
      };
      await saveSettings(nextSettings);
      restoreBatchSizeEl.value = '';
      return;
    }
    const nextSettings: SettingsInput = {
      excludePinned: excludePinnedEl.checked,
      restoreBatchSize: parsed,
      discardRestoredTabs: getDiscardSelection(),
    };
    await saveSettings(nextSettings);
  };

  restoreBatchSizeEl.addEventListener('change', () => {
    void handleBatchSizeChange();
  });

  restoreBatchSizeEl.addEventListener('blur', () => {
    void handleBatchSizeChange();
  });

  const handleDiscardChange = async () => {
    const nextSettings: SettingsInput = {
      excludePinned: excludePinnedEl.checked,
      restoreBatchSize: getRestoreBatchSizeSetting(),
      discardRestoredTabs: getDiscardSelection(),
    };
    await saveSettings(nextSettings);
  };

  for (const radio of discardRadios) {
    radio.addEventListener('change', () => {
      void handleDiscardChange();
    });
  }
}
