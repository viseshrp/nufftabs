import { LIST_PAGE_PATH, STORAGE_KEYS, normalizeSettings, readSettings, type SavedTab } from '../shared/storage';

// Restore tabs in limited parallel batches to improve throughput; this can relax strict
// tab ordering compared to fully sequential creation.
export const RESTORE_CONCURRENCY = 6;
const DISCARD_CONCURRENCY = 8;
const DISCARD_WAIT_TIMEOUT_MS = 5000;

type PendingDiscard = {
  resolve: (ready: boolean) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const pendingDiscards = new Map<number, PendingDiscard>();
let onUpdatedListener: ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) | null =
  null;

function isPlaceholderUrl(url?: string | null): boolean {
  return !url || url === 'about:blank';
}

function cleanupListenerIfIdle(): void {
  if (pendingDiscards.size === 0 && onUpdatedListener) {
    chrome.tabs.onUpdated.removeListener(onUpdatedListener);
    onUpdatedListener = null;
  }
}

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

function cancelPendingDiscards(): void {
  const pendings = Array.from(pendingDiscards.values());
  pendingDiscards.clear();
  for (const pending of pendings) {
    clearTimeout(pending.timeoutId);
    pending.resolve(false);
  }
  cleanupListenerIfIdle();
}

async function waitForTabUrlReady(
  tabId: number,
  timeoutMs = DISCARD_WAIT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && !isPlaceholderUrl(tab.url)) return true;
  } catch {
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

type DiscardSession = {
  schedule: (tabIds: Array<number | undefined | null>) => void;
};

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
      abortController.abort();
      cancelPendingDiscards();
      chrome.storage.onChanged.removeListener(storageListener);
      disposed = true;
    }
  };

  chrome.storage.onChanged.addListener(storageListener);

  return {
    schedule: (tabIds) => {
      if (abortController.signal.aborted) return;
      activeTasks += 1;
      void discardTabsBestEffort(tabIds, abortController.signal).finally(() => {
        activeTasks -= 1;
        maybeCleanup();
      });
    },
  };
}

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
    } catch {
      // Best-effort discard; ignore failures (e.g., active tabs).
    }
  });
}

async function getWindowTabIdsBestEffort(windowId: number): Promise<number[]> {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
  } catch {
    return [];
  }
}

export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  // Executes tasks concurrently for speed; ordering of completion is not guaranteed.
  if (items.length === 0) return;
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      if (current !== undefined) await task(current);
    }
  });
  await Promise.all(workers);
}

export async function createTabsInWindow(windowId: number, urls: string[], startIndex?: number): Promise<number[]> {
  // Uses concurrency-limited creation; tabs may appear slightly out of order versus strict
  // sequential creation, which is accepted for better restore throughput.
  const createdIds: number[] = [];
  const tasks = urls.map((url, offset) => ({
    url,
    index: typeof startIndex === 'number' ? startIndex + offset : undefined,
  }));
  await runWithConcurrency(tasks, RESTORE_CONCURRENCY, async (task) => {
    const createOptions: chrome.tabs.CreateProperties = {
      windowId,
      url: task.url,
      active: false,
    };
    if (typeof task.index === 'number') createOptions.index = task.index;
    const created = await chrome.tabs.create(createOptions);
    if (typeof created.id === 'number') createdIds.push(created.id);
  });
  return createdIds;
}

export async function getReuseWindowContext(): Promise<{
  shouldReuse: boolean;
  windowId?: number;
  tabId?: number;
}> {
  try {
    const currentTab = await chrome.tabs.getCurrent();
    if (!currentTab || typeof currentTab.windowId !== 'number' || typeof currentTab.id !== 'number') {
      return { shouldReuse: false };
    }
    const listUrl = chrome.runtime.getURL(LIST_PAGE_PATH);
    const tabsInWindow = await chrome.tabs.query({ windowId: currentTab.windowId });
    const onlyListTab =
      tabsInWindow.length === 1 && tabsInWindow[0]?.url === listUrl && tabsInWindow[0]?.id === currentTab.id;
    return {
      shouldReuse: onlyListTab,
      windowId: currentTab.windowId,
      tabId: currentTab.id,
    };
  } catch {
    return { shouldReuse: false };
  }
}

export async function restoreTabs(savedTabs: SavedTab[]): Promise<boolean> {
  const settings = await readSettings();
  const shouldDiscard = settings.discardRestoredTabs;
  let discardSession: DiscardSession | null = null;
  const scheduleDiscard = (tabIds: Array<number | undefined | null>) => {
    if (!shouldDiscard) return;
    if (!tabIds.some((id) => typeof id === 'number')) return;
    if (!discardSession) discardSession = createDiscardSession();
    discardSession.schedule(tabIds);
  };
  const chunkSize = settings.restoreBatchSize > 0 ? settings.restoreBatchSize : 100;
  const chunks: SavedTab[][] = [];
  for (let i = 0; i < savedTabs.length; i += chunkSize) {
    chunks.push(savedTabs.slice(i, i + chunkSize));
  }
  try {
    const reuse = await getReuseWindowContext();
    if (reuse.shouldReuse && typeof reuse.tabId === 'number' && typeof reuse.windowId === 'number') {
      const [firstChunk, ...remainingChunks] = chunks;
      if (firstChunk && firstChunk.length > 0) {
        const existingTabs = await chrome.tabs.query({ windowId: reuse.windowId });
        const startIndex = existingTabs.length;
        const createdIds = await createTabsInWindow(
          reuse.windowId,
          firstChunk.map((tab) => tab.url),
          startIndex,
        );
        scheduleDiscard(createdIds);
      }
      await chrome.tabs.update(reuse.tabId, { active: true });
      for (const chunk of remainingChunks) {
        const [first, ...rest] = chunk;
        if (!first) continue;
        const window = await chrome.windows.create({ url: first.url });
        const windowId = window?.id;
        if (typeof windowId !== 'number') {
          throw new Error('Missing window id');
        }
        const firstTabId = window.tabs?.[0]?.id;
        let createdIds: number[] = [];
        if (rest.length > 0) {
          createdIds = await createTabsInWindow(
            windowId,
            rest.map((tab) => tab.url),
            1,
          );
        }
        if (typeof firstTabId === 'number') {
          scheduleDiscard([firstTabId, ...createdIds]);
        } else {
          const fallbackIds = await getWindowTabIdsBestEffort(windowId);
          scheduleDiscard(fallbackIds);
        }
      }
    } else {
      for (const chunk of chunks) {
        const [first, ...rest] = chunk;
        if (!first) continue;
        const window = await chrome.windows.create({ url: first.url });
        const windowId = window?.id;
        if (typeof windowId !== 'number') {
          throw new Error('Missing window id');
        }
        const firstTabId = window.tabs?.[0]?.id;
        let createdIds: number[] = [];
        if (rest.length > 0) {
          createdIds = await createTabsInWindow(
            windowId,
            rest.map((tab) => tab.url),
            1,
          );
        }
        if (typeof firstTabId === 'number') {
          scheduleDiscard([firstTabId, ...createdIds]);
        } else {
          const fallbackIds = await getWindowTabIdsBestEffort(windowId);
          scheduleDiscard(fallbackIds);
        }
      }
    }
  } catch {
    return false;
  }

  return true;
}
