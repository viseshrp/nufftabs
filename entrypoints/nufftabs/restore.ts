/**
 * Tab restoration and memory-saving discard logic.
 * Restores saved tabs into new browser windows using concurrency-limited
 * creation, with optional post-restore tab discarding to save RAM.
 */
import { STORAGE_KEYS, normalizeSettings, readSettings, type SavedTab } from '../shared/storage';
import { logExtensionError, runWithConcurrency } from '../shared/utils';

/**
 * Maximum number of tabs being discarded concurrently after a restore operation.
 * Lower concurrency helps avoid bursty tab lifecycle churn in Chromium.
 */
const DISCARD_CONCURRENCY = 2;

/** How long (ms) to wait for a tab's URL to resolve before giving up on discarding it. */
const DISCARD_WAIT_TIMEOUT_MS = 5000;

/** Internal bookkeeping for a tab whose URL readiness is being awaited. */
type PendingDiscard = {
  resolve: (ready: boolean) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

/** Subset of `chrome.tabs.TabChangeInfo` used by the onUpdated listener. */
type TabChangeInfo = {
  url?: string;
};

/** Map of tab IDs whose URL readiness is being monitored for discard. */
const pendingDiscards = new Map<number, PendingDiscard>();

/** Shared `tabs.onUpdated` listener; installed lazily and removed when idle. */
let onUpdatedListener: ((tabId: number, changeInfo: TabChangeInfo, tab: chrome.tabs.Tab) => void) | null = null;

/** Returns true if the tab is still on a placeholder URL (blank or missing). */
function isPlaceholderUrl(url?: string | null): boolean {
  return !url || url === 'about:blank';
}

/** Removes the shared `onUpdated` listener when no pending discards remain. */
function cleanupListenerIfIdle(): void {
  if (pendingDiscards.size === 0 && onUpdatedListener) {
    chrome.tabs.onUpdated.removeListener(onUpdatedListener);
    onUpdatedListener = null;
  }
}

/** Installs the shared `tabs.onUpdated` listener if not already attached. */
function ensureOnUpdatedListener(): void {
  if (onUpdatedListener) return;
  onUpdatedListener = (tabId, changeInfo, tab) => {
    const pending = pendingDiscards.get(tabId);
    if (!pending) return;
    const url = changeInfo.url ?? tab?.url;
    if (isPlaceholderUrl(url)) return;
    clearTimeout(pending.timeoutId);
    pending.resolve(true);
  };
  chrome.tabs.onUpdated.addListener(onUpdatedListener);
}

/** Resolves all pending discard promises as `false` and removes the listener. */
function cancelPendingDiscards(): void {
  const pendings = Array.from(pendingDiscards.values());
  pendingDiscards.clear();
  for (const pending of pendings) {
    clearTimeout(pending.timeoutId);
    pending.resolve(false);
  }
  cleanupListenerIfIdle();
}

/**
 * Returns a promise that resolves when the given tab has navigated to a real URL.
 * Resolves `false` on timeout or abort signal.
 */
async function waitForTabUrlReady(
  tabId: number,
  timeoutMs = DISCARD_WAIT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && !isPlaceholderUrl(tab.url)) return true;
  } catch (error) {
    logExtensionError(`Failed to check tab readiness for discard (${tabId})`, error, { operation: 'tab_query' });
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const finalize = (ready: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      if (pendingDiscards.has(tabId)) pendingDiscards.delete(tabId);
      resolve(ready);
      cleanupListenerIfIdle();
    };
    onAbort = () => finalize(false);
    timeoutId = setTimeout(() => finalize(false), timeoutMs);
    pendingDiscards.set(tabId, {
      resolve: (ready) => finalize(ready),
      timeoutId,
    });
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    ensureOnUpdatedListener();
  });
}

/** Handle returned by `createDiscardSession` to schedule batches of tabs for discard. */
type DiscardSession = {
  schedule: (tabIds: Array<number | undefined | null>) => void;
};

/**
 * Creates a discard session that monitors settings changes.
 * If the user disables discarding mid-session, all pending discards are aborted.
 */
export function createDiscardSession(): DiscardSession {
  const abortController = new AbortController();
  let activeTasks = 0;
  let disposed = false;

  const maybeCleanup = () => {
    if (disposed) return;
    if (activeTasks === 0 && pendingDiscards.size === 0) {
      chrome.storage.onChanged.removeListener(storageListener);
      disposed = true;
    }
  };

  const storageListener = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: 'local' | 'sync' | 'managed' | 'session',
  ) => {
    if (areaName !== 'local') return;
    const change = changes[STORAGE_KEYS.settings];
    if (!change) return;
    const next = normalizeSettings(change.newValue);
    if (!next.discardRestoredTabs) {
      // Resolve pending discard waits first, then abort in-flight workers.
      // This guarantees pending entries are flushed even if no abort listener ran yet.
      cancelPendingDiscards();
      abortController.abort();
      chrome.storage.onChanged.removeListener(storageListener);
      disposed = true;
    }
  };

  chrome.storage.onChanged.addListener(storageListener);

  return {
    schedule: (tabIds) => {
      if (abortController.signal.aborted) return;
      activeTasks += 1;
      void discardTabsBestEffort(tabIds, abortController.signal)
        .catch((error) => {
          logExtensionError('Unexpected discard session failure', error, { operation: 'runtime_context' });
        })
        .finally(() => {
          activeTasks -= 1;
          maybeCleanup();
        });
    },
  };
}

/** Discards tabs on a best-effort basis, waiting for each tab's URL to be ready first. */
export async function discardTabsBestEffort(
  tabIds: Array<number | undefined | null>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return;
  const ids = tabIds.filter((id): id is number => typeof id === 'number');
  if (ids.length === 0) return;
  const uniqueIds = Array.from(new Set(ids));
  await runWithConcurrency(uniqueIds, DISCARD_CONCURRENCY, async (id) => {
    if (signal?.aborted) return;
    const ready = await waitForTabUrlReady(id, DISCARD_WAIT_TIMEOUT_MS, signal);
    if (!ready || signal?.aborted) return;
    try {
      await chrome.tabs.discard(id);
    } catch (error) {
      logExtensionError(`Failed to discard restored tab (${id})`, error, { operation: 'tab_reload' });
      // Best-effort discard; ignore failures (e.g., active tabs).
    }
  });
}

/** Returns all tabs in a window, best-effort (returns empty on failure). */
async function getWindowTabsBestEffort(windowId: number): Promise<chrome.tabs.Tab[]> {
  try {
    return await chrome.tabs.query({ windowId });
  } catch (error) {
    logExtensionError(`Failed to query window tabs (${windowId})`, error, { operation: 'tab_query' });
    return [];
  }
}

/**
 * Returns true when `observedTabs` contains every expected URL occurrence.
 * Uses multiset matching so duplicate URLs are verified correctly in O(n + m).
 */
function hasExpectedUrls(observedTabs: chrome.tabs.Tab[], expectedUrls: string[]): boolean {
  if (expectedUrls.length === 0) return true;
  const remaining = new Map<string, number>();
  for (const url of expectedUrls) {
    remaining.set(url, (remaining.get(url) ?? 0) + 1);
  }
  for (const tab of observedTabs) {
    // Chrome may expose a target as `pendingUrl` before `url` stabilizes.
    // Match at most one expected URL per tab to preserve duplicate counts.
    const candidates = [
      typeof tab.url === 'string' && tab.url !== 'about:blank' ? tab.url : undefined,
      typeof tab.pendingUrl === 'string' ? tab.pendingUrl : undefined,
      typeof tab.url === 'string' ? tab.url : undefined,
    ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0);
    for (const candidateUrl of candidates) {
      const left = remaining.get(candidateUrl);
      if (!left) continue;
      if (left === 1) {
        remaining.delete(candidateUrl);
      } else {
        remaining.set(candidateUrl, left - 1);
      }
      break;
    }
  }
  return remaining.size === 0;
}

/**
 * Verifies one restored chunk by checking created-tab metadata first, then a
 * window query fallback when metadata is missing from the create response.
 */
async function verifyRestoredChunk(
  windowId: number,
  expectedUrls: string[],
  createdTabs: chrome.tabs.Tab[],
): Promise<{ verified: boolean; tabsForDiscard: chrome.tabs.Tab[] }> {
  if (hasExpectedUrls(createdTabs, expectedUrls)) {
    return { verified: true, tabsForDiscard: createdTabs };
  }
  const queriedTabs = await getWindowTabsBestEffort(windowId);
  if (hasExpectedUrls(queriedTabs, expectedUrls)) {
    return { verified: true, tabsForDiscard: queriedTabs };
  }
  // Caller will treat failed verification as restore failure and keep saved tabs intact.
  return { verified: false, tabsForDiscard: createdTabs.length > 0 ? createdTabs : queriedTabs };
}

/** Re-exported for compatibility with existing restore-module consumers/tests. */
export { runWithConcurrency };

/**
 * Restores an array of saved tabs into new browser windows.
 * Returns true on success; false if an error prevented restoration.
 */
export async function restoreTabs(savedTabs: SavedTab[]): Promise<boolean> {
  const settings = await readSettings();
  const shouldDiscard = settings.discardRestoredTabs;
  let discardSession: DiscardSession | null = null;
  const pendingDiscardIds: number[] = [];
  const collectDiscardCandidates = (tabs: Array<Pick<chrome.tabs.Tab, 'id' | 'active'>>): void => {
    if (!shouldDiscard) return;
    // Keep the focused tab for each restored window so the user does not see a blank active tab.
    const focusedTabId =
      tabs.find((tab) => tab.active && typeof tab.id === 'number')?.id ??
      tabs.find((tab) => typeof tab.id === 'number')?.id;
    for (const tab of tabs) {
      if (typeof tab.id !== 'number') continue;
      if (typeof focusedTabId === 'number' && tab.id === focusedTabId) continue;
      pendingDiscardIds.push(tab.id);
    }
  };
  // `readSettings()` already normalizes this to a positive integer.
  const chunkSize = settings.restoreBatchSize;
  try {
    // Use one window creation call per chunk to minimize tab-strip mutations and
    // reduce extension-driven API churn during bulk restore.
    for (let start = 0; start < savedTabs.length; start += chunkSize) {
      const chunk = savedTabs.slice(start, start + chunkSize);
      const createdWindow = await chrome.windows.create({ url: chunk.map((tab) => tab.url) });
      if (!createdWindow) {
        throw new Error('Missing window');
      }
      const windowId = createdWindow?.id;
      if (typeof windowId !== 'number') {
        throw new Error('Missing window id');
      }
      const createdTabs = createdWindow.tabs ?? [];
      const verification = await verifyRestoredChunk(
        windowId,
        chunk.map((tab) => tab.url),
        createdTabs,
      );
      if (!verification.verified) {
        throw new Error(`Restore verification failed for window ${windowId}`);
      }
      collectDiscardCandidates(verification.tabsForDiscard);
    }
  } catch (error) {
    logExtensionError('Failed to restore tabs', error, { operation: 'tab_query' });
    return false;
  }

  // Run discard only after restore creation is complete to avoid overlapping create/discard churn.
  if (pendingDiscardIds.length > 0) {
    discardSession = createDiscardSession();
    discardSession.schedule(pendingDiscardIds);
  }

  return true;
}
