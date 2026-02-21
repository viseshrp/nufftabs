/**
 * Pure helper functions for the condense ("save and close tabs") workflow.
 * These are shared between the background service worker and the list page.
 */
import { UNKNOWN_GROUP_KEY, createSavedTab, type SavedTab } from './storage';

/** Resolves the effective window ID from an explicit target or the first tab's window. */
export function resolveWindowId(
  tabs: chrome.tabs.Tab[],
  targetWindowId?: number,
): number | undefined {
  if (typeof targetWindowId === 'number') return targetWindowId;
  return tabs.find((tab) => typeof tab.windowId === 'number')?.windowId;
}

/** Generates a unique group key combining window ID, timestamp, and a random nonce. */
export function createCondenseGroupKey(
  windowId?: number,
  now = Date.now(),
  nonce: string = crypto.randomUUID(),
): string {
  const baseKey = typeof windowId === 'number' ? String(windowId) : UNKNOWN_GROUP_KEY;
  // Use a random nonce to avoid collisions across concurrent condense operations.
  return `${baseKey}-${now}-${nonce}`;
}

/** Filters open tabs to only those eligible for condensing (excludes the list page itself and optionally pinned tabs). */
export function filterEligibleTabs(
  tabs: chrome.tabs.Tab[],
  listUrl: string,
  excludePinned: boolean,
): chrome.tabs.Tab[] {
  return tabs.filter((tab) => {
    if (excludePinned && tab.pinned) return false;
    // Chrome may expose pendingUrl before url is populated; treat it as eligible.
    const candidateUrl =
      typeof tab.url === 'string' && tab.url.length > 0 ? tab.url : tab.pendingUrl;
    if (candidateUrl === listUrl) return false;
    return typeof candidateUrl === 'string' && candidateUrl.length > 0;
  });
}

/** Converts eligible Chrome tabs into `SavedTab` objects and prepends them to an existing list. */
export function saveTabsToList(
  tabs: chrome.tabs.Tab[],
  existing: SavedTab[],
  now = Date.now(),
  existingUrls?: Set<string>,
): SavedTab[] {
  const saved: SavedTab[] = [];
  // Track URLs already known to storage when duplicate rejection is enabled.
  const dedupeUrlSet = existingUrls ?? null;
  for (const tab of tabs) {
    // Keep pendingUrl support in sync with filterEligibleTabs to avoid dropping new tabs.
    const candidateUrl =
      typeof tab.url === 'string' && tab.url.length > 0 ? tab.url : tab.pendingUrl;
    if (typeof candidateUrl !== 'string' || candidateUrl.length === 0) continue;
    if (dedupeUrlSet?.has(candidateUrl)) continue;
    saved.push(
      createSavedTab({
        url: candidateUrl,
        title:
          typeof tab.title === 'string' && tab.title.length > 0 ? tab.title : candidateUrl,
        savedAt: now,
      }),
    );
    if (dedupeUrlSet) {
      dedupeUrlSet.add(candidateUrl);
    }
  }
  return saved.length > 0 ? [...saved, ...existing] : existing;
}
