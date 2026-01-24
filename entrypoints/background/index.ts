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

function getSettings(): Promise<{ excludePinned: boolean }> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.settings], (result) => {
      resolve({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
    });
  });
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

function saveTabsToList(tabs: chrome.tabs.Tab[], existing: SavedTab[]): SavedTab[] {
  const now = Date.now();
  const saved = tabs
    .filter((tab) => typeof tab.url === 'string' && tab.url.length > 0)
    .map((tab) => ({
      id: crypto.randomUUID(),
      url: tab.url as string,
      title: tab.title && tab.title.length > 0 ? tab.title : (tab.url as string),
      savedAt: now,
    }));
  return saved.length > 0 ? [...saved, ...existing] : existing;
}

async function condenseCurrentWindow(): Promise<void> {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const eligibleTabs = tabs.filter((tab) => {
    if (settings.excludePinned && tab.pinned) return false;
    return typeof tab.url === 'string' && tab.url.length > 0;
  });

  if (eligibleTabs.length === 0) {
    await openOrFocusListPage();
    return;
  }

  const [existingSaved, tabIds] = await Promise.all([
    getSavedTabs(),
    Promise.resolve(eligibleTabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number')),
  ]);

  const updatedSaved = saveTabsToList(eligibleTabs, existingSaved);
  await setSavedTabs(updatedSaved);

  if (tabIds.length > 0) {
    await chrome.tabs.remove(tabIds);
  }

  await openOrFocusListPage();
}

async function openOrFocusListPage(): Promise<void> {
  const listUrl = browser.runtime.getURL('/nufftabs.html');
  const existing = await chrome.tabs.query({ url: listUrl });
  if (existing.length > 0) {
    const tab = existing[0];
    if (typeof tab.id === 'number') {
      await chrome.tabs.update(tab.id, { active: true });
    }
    if (typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url: listUrl });
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener(() => {
    void condenseCurrentWindow();
  });
});
