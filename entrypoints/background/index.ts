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
  const listTabs = await chrome.tabs.query({ url: listUrl });
  const listTabInTarget =
    typeof resolvedWindowId === 'number'
      ? listTabs.find((tab) => tab.windowId === resolvedWindowId && typeof tab.id === 'number')
      : undefined;
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

  let listTabId: number | undefined;
  let listTabAction: string | undefined;
  if (listTabInTarget && typeof listTabInTarget.id === 'number') {
    listTabId = listTabInTarget.id;
    listTabAction = 'found';
  }

  if (eligibleTabs.length === 0) {
    if (typeof listTabId !== 'number') {
      try {
        const result = await ensureListTabInWindow(listUrl, resolvedWindowId);
        listTabId = result.tabId;
        listTabAction = result.action;
        console.info('[nufftabs] list tab ensured', { listTabId, listTabAction });
      } catch (error) {
        console.error('[nufftabs] ensure list tab failed', error);
      }
    }
    await focusAndPinListTab(listTabId, resolvedWindowId);
    return;
  }

  const [existingSaved, tabIds] = await Promise.all([
    getSavedTabs(),
    Promise.resolve(eligibleTabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number')),
  ]);

  const updatedSaved = saveTabsToList(eligibleTabs, existingSaved);
  await setSavedTabs(updatedSaved);

  if (excludedCount === 0 && typeof listTabId !== 'number') {
    try {
      const result = await ensureListTabInWindow(listUrl, resolvedWindowId);
      listTabId = result.tabId;
      listTabAction = result.action;
      console.info('[nufftabs] list tab ensured before close', { listTabId, listTabAction });
    } catch (error) {
      console.error('[nufftabs] ensure list tab failed', error);
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

  if (typeof listTabId !== 'number') {
    try {
      const result = await ensureListTabInWindow(listUrl, resolvedWindowId);
      listTabId = result.tabId;
      listTabAction = result.action;
      console.info('[nufftabs] list tab ensured after close', { listTabId, listTabAction });
    } catch (error) {
      console.error('[nufftabs] ensure list tab failed', error);
    }
  }

  await focusAndPinListTab(listTabId, resolvedWindowId);
}

async function ensureListTabInWindow(
  listUrl: string,
  targetWindowId?: number,
): Promise<{ tabId?: number; action: 'found' | 'moved' | 'created' | 'unknown' }> {
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
    return { tabId: inTarget.id, action: 'found' };
  }

  const existingTab = existing.find((tab) => typeof tab.id === 'number');
  if (existingTab && typeof existingTab.id === 'number' && typeof targetId === 'number') {
    await chrome.tabs.move(existingTab.id, { windowId: targetId, index: -1 });
    console.info('[nufftabs] moved list tab', { tabId: existingTab.id, targetId });
    return { tabId: existingTab.id, action: 'moved' };
  }

  const created = await chrome.tabs.create({ url: listUrl, windowId: targetId, active: false });
  console.info('[nufftabs] created list tab', { tabId: created.id, targetId });
  return { tabId: created.id, action: 'created' };
}

async function focusAndPinListTab(
  listTabId: number | undefined,
  targetWindowId?: number,
): Promise<void> {
  if (typeof listTabId !== 'number') {
    await openOrFocusListPage(targetWindowId);
    return;
  }

  try {
    await chrome.tabs.update(listTabId, { active: true });
    await chrome.tabs.update(listTabId, { pinned: true });
    console.info('[nufftabs] focused + pinned list tab', { listTabId });
    if (typeof targetWindowId === 'number') {
      await chrome.windows.update(targetWindowId, { focused: true });
      console.info('[nufftabs] focused window', { targetWindowId });
    }
  } catch (error) {
    console.error('[nufftabs] focus/pin list tab failed', error);
  }
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
