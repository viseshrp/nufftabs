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
    const candidateUrl =
      typeof tab.url === 'string' && tab.url.length > 0 ? tab.url : tab.pendingUrl;
    if (candidateUrl === listUrl) return false;
    return typeof candidateUrl === 'string' && candidateUrl.length > 0;
  });
}

export function saveTabsToList(
  tabs: chrome.tabs.Tab[],
  existing: SavedTab[],
  now = Date.now(),
): SavedTab[] {
  const saved: SavedTab[] = [];
  for (const tab of tabs) {
    const candidateUrl =
      typeof tab.url === 'string' && tab.url.length > 0 ? tab.url : tab.pendingUrl;
    if (typeof candidateUrl !== 'string' || candidateUrl.length === 0) continue;
    saved.push(
      createSavedTab({
        url: candidateUrl,
        title:
          typeof tab.title === 'string' && tab.title.length > 0 ? tab.title : candidateUrl,
        savedAt: now,
      }),
    );
  }
  return saved.length > 0 ? [...saved, ...existing] : existing;
}
