import { LIST_PAGE_PATH, readSettings, type SavedTab } from '../shared/storage';

// Restore tabs in limited parallel batches to improve throughput; this can relax strict
// tab ordering compared to fully sequential creation.
export const RESTORE_CONCURRENCY = 6;

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

export async function createTabsInWindow(windowId: number, urls: string[], startIndex?: number): Promise<void> {
  // Uses concurrency-limited creation; tabs may appear slightly out of order versus strict
  // sequential creation, which is accepted for better restore throughput.
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
    await chrome.tabs.create(createOptions);
  });
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
        await createTabsInWindow(
          reuse.windowId,
          firstChunk.map((tab) => tab.url),
          startIndex,
        );
      }
      await chrome.tabs.update(reuse.tabId, { active: true });
      for (const chunk of remainingChunks) {
        const [first, ...rest] = chunk;
        if (!first) continue;
        const window = await chrome.windows.create({ url: first.url });
        const windowId = window.id;
        if (typeof windowId !== 'number') {
          throw new Error('Missing window id');
        }
        if (rest.length > 0) {
          await createTabsInWindow(
            windowId,
            rest.map((tab) => tab.url),
            1,
          );
        }
      }
    } else {
      for (const chunk of chunks) {
        const [first, ...rest] = chunk;
        if (!first) continue;
        const window = await chrome.windows.create({ url: first.url });
        const windowId = window.id;
        if (typeof windowId !== 'number') {
          throw new Error('Missing window id');
        }
        if (rest.length > 0) {
          await createTabsInWindow(
            windowId,
            rest.map((tab) => tab.url),
            1,
          );
        }
      }
    }
  } catch {
    return false;
  }

  return true;
}
