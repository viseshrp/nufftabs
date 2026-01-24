import './style.css';

type SavedTab = {
  id: string;
  url: string;
  title: string;
  savedAt: number;
};

const STORAGE_KEYS = {
  savedTabs: 'savedTabs',
  settings: 'settings',
} as const;

const DEFAULT_SETTINGS = {
  excludePinned: true,
};

const listEl = document.querySelector<HTMLUListElement>('#list');
const emptyEl = document.querySelector<HTMLDivElement>('#empty');
const statusEl = document.querySelector<HTMLDivElement>('#status');
const excludePinnedEl = document.querySelector<HTMLInputElement>('#excludePinned');
const restoreAllEl = document.querySelector<HTMLButtonElement>('#restoreAll');
const deleteAllEl = document.querySelector<HTMLButtonElement>('#deleteAll');

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

function getSavedTabs(): Promise<SavedTab[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.savedTabs], (result) => {
      resolve(Array.isArray(result.savedTabs) ? result.savedTabs : []);
    });
  });
}

function setSavedTabs(savedTabs: SavedTab[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.savedTabs]: savedTabs }, () => resolve());
  });
}

function getSettings(): Promise<{ excludePinned: boolean }> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.settings], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
    });
  });
}

function setSettings(settings: { excludePinned: boolean }): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings }, () => resolve());
  });
}

async function initSettings(): Promise<void> {
  if (!excludePinnedEl) return;
  const settings = await getSettings();
  excludePinnedEl.checked = settings.excludePinned;
  excludePinnedEl.addEventListener('change', async () => {
    await setSettings({ excludePinned: excludePinnedEl.checked });
    setStatus('Settings saved.');
  });
}

function renderList(savedTabs: SavedTab[]): void {
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = '';

  if (savedTabs.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  emptyEl.style.display = 'none';
  for (const tab of savedTabs) {
    const item = document.createElement('li');
    item.className = 'item';

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = tab.title;

    const url = document.createElement('div');
    url.className = 'item-url';
    url.textContent = tab.url;

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const restoreButton = document.createElement('button');
    restoreButton.textContent = 'Restore';
    restoreButton.addEventListener('click', () => {
      void restoreSingle(tab.id);
    });

    actions.appendChild(restoreButton);
    item.appendChild(title);
    item.appendChild(url);
    item.appendChild(actions);
    listEl.appendChild(item);
  }
}

async function restoreSingle(id: string): Promise<void> {
  const savedTabs = await getSavedTabs();
  const tab = savedTabs.find((entry) => entry.id === id);
  if (!tab) {
    setStatus('Tab not found.');
    return;
  }

  await chrome.windows.create({ url: tab.url });
  const updated = savedTabs.filter((entry) => entry.id !== id);
  await setSavedTabs(updated);
  renderList(updated);
  setStatus('Restored 1 tab.');
}

async function restoreAll(): Promise<void> {
  const savedTabs = await getSavedTabs();
  if (savedTabs.length === 0) {
    setStatus('No tabs to restore.');
    return;
  }

  const [first, ...rest] = savedTabs;
  const window = await chrome.windows.create({ url: first.url });
  const windowId = window.id;
  if (typeof windowId === 'number') {
    for (const tab of rest) {
      await chrome.tabs.create({ windowId, url: tab.url });
    }
  }

  await setSavedTabs([]);
  renderList([]);
  setStatus('Restored all tabs.');
}

async function deleteAll(): Promise<void> {
  await setSavedTabs([]);
  renderList([]);
  setStatus('Deleted all tabs.');
}

async function init(): Promise<void> {
  await initSettings();
  const savedTabs = await getSavedTabs();
  renderList(savedTabs);

  restoreAllEl?.addEventListener('click', () => {
    void restoreAll();
  });

  deleteAllEl?.addEventListener('click', () => {
    void deleteAll();
  });
}

void init();
