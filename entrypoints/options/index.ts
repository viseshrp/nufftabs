import './style.css';

const STORAGE_KEYS = {
  settings: 'settings',
} as const;

const DEFAULT_SETTINGS = {
  excludePinned: true,
};

const excludePinnedEl = document.querySelector<HTMLInputElement>('#excludePinned');
const statusEl = document.querySelector<HTMLDivElement>('#status');

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

function getSettings(): Promise<{ excludePinned: boolean }> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEYS.settings], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
    });
  });
}

function setSettings(settings: { excludePinned: boolean }): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ [STORAGE_KEYS.settings]: settings }, () => resolve());
  });
}

async function init(): Promise<void> {
  if (!excludePinnedEl) return;
  const settings = await getSettings();
  excludePinnedEl.checked = settings.excludePinned;
  excludePinnedEl.addEventListener('change', async () => {
    await setSettings({ excludePinned: excludePinnedEl.checked });
    setStatus('Settings saved.');
  });
}

void init();
