import {
  createSavedTab,
  LIST_PAGE_PATH,
  readSavedGroups,
  readSettings,
  UNKNOWN_GROUP_KEY,
  writeSavedGroups,
  type SavedTab,
} from '../shared/storage';

function saveTabsToList(tabs: chrome.tabs.Tab[], existing: SavedTab[]): SavedTab[] {
  const savedAt = Date.now();
  const saved: SavedTab[] = [];
  for (const tab of tabs) {
    if (typeof tab.url !== 'string' || tab.url.length === 0) continue;
    saved.push(
      createSavedTab({
        url: tab.url,
        title: typeof tab.title === 'string' && tab.title.length > 0 ? tab.title : tab.url,
        savedAt,
      }),
    );
  }
  return saved.length > 0 ? [...saved, ...existing] : existing;
}

async function condenseCurrentWindow(targetWindowId?: number): Promise<void> {
  const settings = await readSettings();
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query(
      typeof targetWindowId === 'number' ? { windowId: targetWindowId } : { currentWindow: true },
    );
  } catch {
    return;
  }
  const resolvedWindowId =
    typeof targetWindowId === 'number'
      ? targetWindowId
      : tabs.find((tab) => typeof tab.windowId === 'number')?.windowId;
  const listUrl = chrome.runtime.getURL(LIST_PAGE_PATH);
  let listTabs: chrome.tabs.Tab[] = [];
  try {
    listTabs = await chrome.tabs.query({ url: listUrl });
  } catch {
    listTabs = [];
  }
  const eligibleTabs = tabs.filter((tab) => {
    if (settings.excludePinned && tab.pinned) return false;
    if (tab.url === listUrl) return false;
    return typeof tab.url === 'string' && tab.url.length > 0;
  });

  if (eligibleTabs.length === 0) {
    await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
    return;
  }

  const groupKey = typeof resolvedWindowId === 'number' ? String(resolvedWindowId) : UNKNOWN_GROUP_KEY;
  const [existingGroups, tabIds] = await Promise.all([
    readSavedGroups(groupKey),
    Promise.resolve(eligibleTabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number')),
  ]);

  const existingGroup = existingGroups[groupKey] ?? [];
  const updatedGroup = saveTabsToList(eligibleTabs, existingGroup);
  existingGroups[groupKey] = updatedGroup;
  const saved = await writeSavedGroups(existingGroups);
  if (!saved) {
    await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
    return;
  }

  if (tabs.length === eligibleTabs.length && listTabs.length === 0 && typeof resolvedWindowId === 'number') {
    try {
      const created = await chrome.tabs.create({
        url: listUrl,
        windowId: resolvedWindowId,
        active: false,
      });
      listTabs = created ? [created] : listTabs;
    } catch (error) {
      void error;
    }
  }

  if (tabIds.length > 0) {
    try {
      await chrome.tabs.remove(tabIds);
    } catch (error) {
      void error;
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
      return;
    } catch (error) {
      void error;
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
  } catch (error) {
    void error;
  }
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId);
  });
});
