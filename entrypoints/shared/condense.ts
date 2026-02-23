/**
 * Pure helper functions for the condense ("save and close tabs") workflow.
 * These are shared between the background service worker and the list page.
 */
import { UNKNOWN_GROUP_KEY, createSavedTab, type SavedTab } from './storage';

/**
 * URL prefixes that identify browser-internal pages we should not condense.
 * Condensing these pages is not useful because they are browser UI/privileged
 * surfaces rather than user content tabs.
 */
const INTERNAL_TAB_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'chrome-search://',
  'chrome-untrusted://',
  'devtools://',
  'about:',
] as const;

/** Returns true when a tab URL is non-empty and safe to persist/close during condense. */
function isCondensableTabUrl(url: string): boolean {
  const normalizedUrl = url.trim().toLowerCase();
  if (normalizedUrl.length === 0) return false;
  return !INTERNAL_TAB_URL_PREFIXES.some((prefix) => normalizedUrl.startsWith(prefix));
}

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
  const normalizedListUrl = listUrl.trim().toLowerCase();
  return tabs.filter((tab) => {
    if (excludePinned && tab.pinned) return false;
    // Chrome may expose pendingUrl before url is populated; treat it as eligible.
    const candidateUrl =
      typeof tab.url === 'string' && tab.url.length > 0 ? tab.url : tab.pendingUrl;
    if (typeof candidateUrl !== 'string') return false;
    const normalizedCandidateUrl = candidateUrl.trim().toLowerCase();
    if (normalizedCandidateUrl === normalizedListUrl) return false;
    return isCondensableTabUrl(candidateUrl);
  });
}

/** Converts eligible Chrome tabs into `SavedTab` objects and prepends them to an existing list. */
export function saveTabsToList(
  tabs: chrome.tabs.Tab[],
  existing: SavedTab[],
  now = Date.now(),
): SavedTab[] {
  const saved: SavedTab[] = [];
  for (const tab of tabs) {
    // Keep pendingUrl support in sync with filterEligibleTabs to avoid dropping new tabs.
    const candidateUrl =
      typeof tab.url === 'string' && tab.url.length > 0 ? tab.url : tab.pendingUrl;
    if (typeof candidateUrl !== 'string' || !isCondensableTabUrl(candidateUrl)) continue;
    saved.push(
      createSavedTab({
        // Persist the original URL string (not lowercased) so user-visible text remains unchanged.
        url: candidateUrl,
        title:
          typeof tab.title === 'string' && tab.title.length > 0 ? tab.title : candidateUrl,
        savedAt: now,
      }),
    );
  }
  return saved.length > 0 ? [...saved, ...existing] : existing;
}
