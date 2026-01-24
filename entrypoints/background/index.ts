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

async function condenseCurrentWindow(targetWindowId?: number): Promise<void> {
  const settings = await getSettings();
  const tabs = await chrome.tabs.query(
    typeof targetWindowId === 'number' ? { windowId: targetWindowId } : { currentWindow: true },
  );
  const resolvedWindowId =
    typeof targetWindowId === 'number'
      ? targetWindowId
      : tabs.find((tab) => typeof tab.windowId === 'number')?.windowId;
  const listUrl = browser.runtime.getURL('/nufftabs.html');
  let listTabs = await chrome.tabs.query({ url: listUrl });
  const listUiTabFound = listTabs.length > 0;
  const eligibleTabs = tabs.filter((tab) => {
    if (settings.excludePinned && tab.pinned) return false;
    if (tab.url === listUrl) return false;
    return typeof tab.url === 'string' && tab.url.length > 0;
  });
  const excludedCount = tabs.length - eligibleTabs.length;
  console.info('[nufftabs] condense', {
    windowId: resolvedWindowId,
    totalTabs: tabs.length,
    eligibleCount: eligibleTabs.length,
    excludedCount,
    listUiTabFound,
    listUrl,
  });

  if (eligibleTabs.length === 0) {
    await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
    return;
  }

  const [existingSaved, tabIds] = await Promise.all([
    getSavedTabs(),
    Promise.resolve(eligibleTabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number')),
  ]);

  const updatedSaved = saveTabsToList(eligibleTabs, existingSaved);
  await setSavedTabs(updatedSaved);

  if (excludedCount === 0 && listTabs.length === 0 && typeof resolvedWindowId === 'number') {
    try {
      const created = await chrome.tabs.create({
        url: listUrl,
        windowId: resolvedWindowId,
        active: false,
      });
      listTabs = created ? [created] : listTabs;
      console.info('[nufftabs] created list tab before close', {
        tabId: created?.id,
        windowId: created?.windowId,
      });
    } catch (error) {
      console.error('[nufftabs] create list tab before close failed', error);
    }
  }

  if (tabIds.length > 0) {
    try {
      await chrome.tabs.remove(tabIds);
      console.info('[nufftabs] closed tabs', { tabIds });
    } catch (error) {
      console.error('[nufftabs] close tabs failed', error);
    }
  }

  await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
}

function pickMostRecentListTab(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined {
  return tabs.reduce<chrome.tabs.Tab | undefined>((best, tab) => {
    if (!best) return tab;
    const bestAccessed = typeof best.lastAccessed === 'number' ? best.lastAccessed : 0;
    const tabAccessed = typeof tab.lastAccessed === 'number' ? tab.lastAccessed : 0;
    if (tabAccessed > bestAccessed) return tab;
    if (tabAccessed === bestAccessed && tab.active && !best.active) return tab;
    return best;
  }, undefined);
}

async function focusExistingListTabOrCreate(
  listTabs: chrome.tabs.Tab[],
  listUrl: string,
  preferredWindowId?: number,
): Promise<void> {
  const existing = pickMostRecentListTab(listTabs);
  if (existing && typeof existing.id === 'number') {
    try {
      await chrome.tabs.update(existing.id, { active: true, pinned: true });
      if (typeof existing.windowId === 'number') {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      console.info('[nufftabs] focused existing list tab', {
        tabId: existing.id,
        windowId: existing.windowId,
      });
      return;
    } catch (error) {
      console.error('[nufftabs] focus existing list tab failed', error);
    }
  }

  try {
    const created = await chrome.tabs.create(
      typeof preferredWindowId === 'number'
        ? { url: listUrl, windowId: preferredWindowId, active: true }
        : { url: listUrl, active: true },
    );
    if (typeof created.id === 'number') {
      await chrome.tabs.update(created.id, { pinned: true });
    }
    if (typeof created.windowId === 'number') {
      await chrome.windows.update(created.windowId, { focused: true });
    }
    console.info('[nufftabs] created list tab', { tabId: created.id, windowId: created.windowId });
  } catch (error) {
    console.error('[nufftabs] create list tab failed', error);
  }
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId);
  });
});
