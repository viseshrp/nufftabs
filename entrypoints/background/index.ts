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
  console.info('[nufftabs] condense', {
    targetWindowId,
    resolvedWindowId,
    listUrl,
    tabCount: tabs.length,
  });
  let listTabId: number | undefined;
  try {
    listTabId = await ensureListTabInWindow(listUrl, resolvedWindowId);
    console.info('[nufftabs] ensure list tab', { listTabId });
  } catch (error) {
    console.error('[nufftabs] ensure list tab failed', error);
  }
  const eligibleTabs = tabs.filter((tab) => {
    if (settings.excludePinned && tab.pinned) return false;
    if (tab.id === listTabId) return false;
    if (tab.url === listUrl) return false;
    return typeof tab.url === 'string' && tab.url.length > 0;
  });

  if (eligibleTabs.length === 0) {
    if (typeof listTabId === 'number') {
      try {
        await chrome.tabs.update(listTabId, { active: true });
        console.info('[nufftabs] focused list tab', { listTabId });
        if (typeof resolvedWindowId === 'number') {
          await chrome.windows.update(resolvedWindowId, { focused: true });
          console.info('[nufftabs] focused window', { resolvedWindowId });
        }
      } catch (error) {
        console.error('[nufftabs] focus list tab failed', error);
      }
    } else {
      await openOrFocusListPage(resolvedWindowId);
    }
    return;
  }

  const [existingSaved, tabIds] = await Promise.all([
    getSavedTabs(),
    Promise.resolve(eligibleTabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number')),
  ]);

  const updatedSaved = saveTabsToList(eligibleTabs, existingSaved);
  await setSavedTabs(updatedSaved);

  if (tabIds.length > 0) {
    try {
      await chrome.tabs.remove(tabIds);
      console.info('[nufftabs] closed tabs', { tabIds });
    } catch (error) {
      console.error('[nufftabs] close tabs failed', error);
    }
  }

  if (typeof listTabId === 'number') {
    try {
      await chrome.tabs.update(listTabId, { active: true });
      console.info('[nufftabs] focused list tab', { listTabId });
      if (typeof resolvedWindowId === 'number') {
        await chrome.windows.update(resolvedWindowId, { focused: true });
        console.info('[nufftabs] focused window', { resolvedWindowId });
      }
    } catch (error) {
      console.error('[nufftabs] focus list tab failed', error);
    }
  } else {
    await openOrFocusListPage(resolvedWindowId);
  }
}

async function ensureListTabInWindow(
  listUrl: string,
  targetWindowId?: number,
): Promise<number | undefined> {
  const existing = await chrome.tabs.query({ url: listUrl });
  const targetId = typeof targetWindowId === 'number' ? targetWindowId : undefined;
  const inTarget = targetId
    ? existing.find((tab) => tab.windowId === targetId && typeof tab.id === 'number')
    : undefined;
  console.info('[nufftabs] list tabs found', {
    total: existing.length,
    targetId,
    inTarget: Boolean(inTarget),
  });

  if (inTarget && typeof inTarget.id === 'number') {
    return inTarget.id;
  }

  const existingTab = existing.find((tab) => typeof tab.id === 'number');
  if (existingTab && typeof existingTab.id === 'number' && typeof targetId === 'number') {
    await chrome.tabs.move(existingTab.id, { windowId: targetId, index: -1 });
    console.info('[nufftabs] moved list tab', { tabId: existingTab.id, targetId });
    return existingTab.id;
  }

  const created = await chrome.tabs.create({ url: listUrl, windowId: targetId, active: false });
  console.info('[nufftabs] created list tab', { tabId: created.id, targetId });
  return created.id;
}

async function openOrFocusListPage(targetWindowId?: number): Promise<void> {
  const listUrl = browser.runtime.getURL('/nufftabs.html');
  const existing = await chrome.tabs.query({ url: listUrl });
  const targetId = typeof targetWindowId === 'number' ? targetWindowId : undefined;
  const inTarget = targetId
    ? existing.find((tab) => tab.windowId === targetId)
    : undefined;
  console.info('[nufftabs] open/focus list page', { listUrl, targetId, existing: existing.length });

  try {
    if (inTarget && typeof inTarget.id === 'number') {
      await chrome.tabs.update(inTarget.id, { active: true });
      await chrome.windows.update(inTarget.windowId!, { focused: true });
      console.info('[nufftabs] focused existing list tab', { tabId: inTarget.id });
      return;
    }

    const existingTab = existing.find((tab) => typeof tab.id === 'number');
    if (existingTab && typeof existingTab.id === 'number' && typeof targetId === 'number') {
      await chrome.tabs.move(existingTab.id, { windowId: targetId, index: -1 });
      await chrome.tabs.update(existingTab.id, { active: true });
      await chrome.windows.update(targetId, { focused: true });
      console.info('[nufftabs] moved and focused list tab', { tabId: existingTab.id, targetId });
      return;
    }

    const created = await chrome.tabs.create({ url: listUrl, windowId: targetId });
    console.info('[nufftabs] created list tab', { tabId: created.id, targetId });
  } catch (error) {
    console.error('[nufftabs] open/focus list page failed', error);
  }
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId);
  });
});
