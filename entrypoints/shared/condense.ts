import { UNKNOWN_GROUP_KEY, createSavedTab, type SavedTab } from './storage';

export function resolveWindowId(
  tabs: chrome.tabs.Tab[],
  targetWindowId?: number,
): number | undefined {
  if (typeof targetWindowId === 'number') return targetWindowId;
  return tabs.find((tab) => typeof tab.windowId === 'number')?.windowId;
}

export function createCondenseGroupKey(
  windowId?: number,
  now = Date.now(),
  nonce: string = crypto.randomUUID(),
): string {
  const baseKey = typeof windowId === 'number' ? String(windowId) : UNKNOWN_GROUP_KEY;
  return `${baseKey}-${now}-${nonce}`;
}

export function filterEligibleTabs(
  tabs: chrome.tabs.Tab[],
  listUrl: string,
  excludePinned: boolean,
): chrome.tabs.Tab[] {
  return tabs.filter((tab) => {
    if (excludePinned && tab.pinned) return false;
    if (tab.url === listUrl) return false;
    return typeof tab.url === 'string' && tab.url.length > 0;
  });
}

export function saveTabsToList(
  tabs: chrome.tabs.Tab[],
  existing: SavedTab[],
  now = Date.now(),
): SavedTab[] {
  const saved: SavedTab[] = [];
  for (const tab of tabs) {
    if (typeof tab.url !== 'string' || tab.url.length === 0) continue;
    saved.push(
      createSavedTab({
        url: tab.url,
        title: typeof tab.title === 'string' && tab.title.length > 0 ? tab.title : tab.url,
        savedAt: now,
      }),
    );
  }
  return saved.length > 0 ? [...saved, ...existing] : existing;
}
