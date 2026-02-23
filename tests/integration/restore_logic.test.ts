import { describe, expect, it, vi } from 'vitest';
import { LIST_PAGE_PATH } from '../../entrypoints/shared/storage';
import {
  createDiscardSession,
  discardTabsBestEffort,
  restoreTabs,
} from '../../entrypoints/nufftabs/restore';
import { writeSettings } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

/**
 * Waits until the mock discard API has been called `expected` times.
 * This avoids time-based polling and keeps discard assertions deterministic.
 */
function waitForDiscardCalls(mock: ReturnType<typeof createMockChrome>, expected: number): Promise<void> {
  if (expected === 0) return Promise.resolve();
  const originalDiscard = mock.chrome.tabs.discard;
  let observed = 0;
  return new Promise((resolve) => {
    mock.chrome.tabs.discard = async (tabId: number) => {
      const result = await originalDiscard(tabId);
      observed += 1;
      if (observed >= expected) {
        mock.chrome.tabs.discard = originalDiscard;
        resolve();
      }
      return result;
    };
  });
}

/**
 * Waits for a predicate to become true by yielding microtasks.
 * Fails after a bounded number of cycles to avoid hanging tests.
 */
async function waitForPredicate(predicate: () => boolean, maxCycles = 50): Promise<void> {
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Condition did not become true');
}

describe('restore logic', () => {
  it('keeps the list window untouched and restores into chunked windows', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 2 });

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    const listTabId = window.tabs?.[0]?.id as number;
    mock.setCurrentTab(listTabId);

    const savedTabs = [
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
      { id: '3', url: 'https://c.com', title: 'C', savedAt: 1 },
    ];

    const restored = await restoreTabs(savedTabs);
    expect(restored).toBe(true);

    const tabsInListWindow = await mock.chrome.tabs.query({ windowId: window.id as number });
    expect(tabsInListWindow).toHaveLength(1);
    expect(tabsInListWindow[0]?.url).toBe(listUrl);
    expect(tabsInListWindow[0]?.active).toBe(true);

    expect(mock.windows.size).toBe(3);
    const cTab = (await mock.chrome.tabs.query({ url: 'https://c.com' }))[0];
    expect(cTab?.windowId).not.toBe(window.id);
  });

  it('creates new windows for restore batches', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 2 });

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl, 'https://existing.com']);
    mock.setCurrentTab(window.tabs?.[0]?.id as number);

    const savedTabs = [
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
      { id: '3', url: 'https://c.com', title: 'C', savedAt: 1 },
    ];

    const restored = await restoreTabs(savedTabs);
    expect(restored).toBe(true);
    expect(mock.windows.size).toBeGreaterThanOrEqual(2);
  });

  it('restores duplicate URLs without under-counting verification matches', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const restored = await restoreTabs([
      { id: '1', url: 'https://dup-verify.example', title: 'Duplicate A', savedAt: 1 },
      { id: '2', url: 'https://dup-verify.example', title: 'Duplicate B', savedAt: 1 },
    ]);
    expect(restored).toBe(true);

    const restoredDuplicates = await mock.chrome.tabs.query({ url: 'https://dup-verify.example' });
    expect(restoredDuplicates).toHaveLength(2);
  });

  it('returns false when restoration fails', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    mock.chrome.windows.create = async () => {
      throw new Error('boom');
    };

    const savedTabs = [
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
    ];

    const restored = await restoreTabs(savedTabs);
    expect(restored).toBe(false);
  });

  it('handles empty restore lists', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const restored = await restoreTabs([]);
    expect(restored).toBe(true);
  });

  it('returns false when window creation unexpectedly returns undefined', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    mock.chrome.windows.create = async () => undefined as unknown as chrome.windows.Window;

    const restored = await restoreTabs([{ id: '1', url: 'https://a.com', title: 'A', savedAt: 1 }]);
    expect(restored).toBe(false);
  });

  it('fails when window id is missing', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 1 });
    mock.chrome.windows.create = async () => ({} as chrome.windows.Window);

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    mock.setCurrentTab(window.tabs?.[0]?.id as number);

    const restored = await restoreTabs([
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
    ]);
    expect(restored).toBe(false);
  });

  it('restores chunked tabs into separate windows for each batch', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 2 });

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    mock.setCurrentTab(window.tabs?.[0]?.id as number);

    const savedTabs = [
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
      { id: '3', url: 'https://c.com', title: 'C', savedAt: 1 },
      { id: '4', url: 'https://d.com', title: 'D', savedAt: 1 },
      { id: '5', url: 'https://e.com', title: 'E', savedAt: 1 },
    ];

    const restored = await restoreTabs(savedTabs);
    expect(restored).toBe(true);

    expect(mock.windows.size).toBe(4);

    const listWindowTabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    expect(listWindowTabs).toHaveLength(1);
    expect(listWindowTabs[0]?.url).toBe(listUrl);

    const aTab = (await mock.chrome.tabs.query({ url: 'https://a.com' }))[0];
    const bTab = (await mock.chrome.tabs.query({ url: 'https://b.com' }))[0];
    const cTab = (await mock.chrome.tabs.query({ url: 'https://c.com' }))[0];
    const dTab = (await mock.chrome.tabs.query({ url: 'https://d.com' }))[0];
    const eTab = (await mock.chrome.tabs.query({ url: 'https://e.com' }))[0];

    expect(aTab?.windowId).toBeDefined();
    expect(bTab?.windowId).toBeDefined();
    expect(cTab?.windowId).toBeDefined();
    expect(dTab?.windowId).toBeDefined();
    expect(eTab?.windowId).toBeDefined();
    expect(aTab?.windowId).toBe(bTab?.windowId);
    expect(aTab?.windowId).not.toBe(window.id);
    expect(cTab?.windowId).toBe(dTab?.windowId);
    expect(cTab?.windowId).not.toBe(window.id);
    expect(eTab?.windowId).not.toBe(window.id);
    expect(eTab?.windowId).not.toBe(cTab?.windowId);
  });

  it('handles getCurrent errors', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    mock.chrome.tabs.getCurrent = async () => {
      throw new Error('boom');
    };

    const restored = await restoreTabs([{ id: '1', url: 'https://a.com', title: 'A', savedAt: 1 }]);
    expect(restored).toBe(true);
  });

  it('discards restored tabs when enabled but keeps the focused tab', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 2, discardRestoredTabs: true });

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    const listTabId = window.tabs?.[0]?.id as number;
    mock.setCurrentTab(listTabId);

    const discardObserved = waitForDiscardCalls(mock, 1);

    const restored = await restoreTabs([
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
    ]);
    expect(restored).toBe(true);
    await discardObserved;

    const restoredTabs = (await mock.chrome.tabs.query({}))
      .filter((tab: chrome.tabs.Tab) => tab.url === 'https://a.com' || tab.url === 'https://b.com');
    expect(restoredTabs).toHaveLength(2);
    expect(restoredTabs.filter((tab) => tab.discarded)).toHaveLength(1);
    const focused = restoredTabs.find((tab) => tab.active);
    expect(focused?.discarded).toBe(false);
  });

  it('keeps one focused tab per restore chunk when discarding is enabled', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 2, discardRestoredTabs: true });

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    const listTabId = window.tabs?.[0]?.id as number;
    mock.setCurrentTab(listTabId);

    const discardObserved = waitForDiscardCalls(mock, 1);

    const restored = await restoreTabs([
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
      { id: '3', url: 'https://c.com', title: 'C', savedAt: 1 },
    ]);
    expect(restored).toBe(true);
    await discardObserved;

    const restoredTabs = (await mock.chrome.tabs.query({})).filter(
      (tab: chrome.tabs.Tab) => tab.url === 'https://a.com' || tab.url === 'https://b.com' || tab.url === 'https://c.com',
    );
    expect(restoredTabs).toHaveLength(3);
    expect(restoredTabs.filter((tab) => tab.discarded)).toHaveLength(1);
    expect(restoredTabs.filter((tab) => !tab.discarded && tab.active)).toHaveLength(2);
  });

  it('falls back to the first tab when active metadata is unavailable', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 2, discardRestoredTabs: true });

    const originalCreate = mock.chrome.windows.create;
    mock.chrome.windows.create = async (createData?: chrome.windows.CreateData) => {
      const created = await originalCreate(createData);
      for (const tab of created.tabs ?? []) {
        // Simulate environments where active-state metadata is missing from create response.
        delete (tab as { active?: boolean }).active;
      }
      return created;
    };

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    const listTabId = window.tabs?.[0]?.id as number;
    mock.setCurrentTab(listTabId);

    const discardObserved = waitForDiscardCalls(mock, 1);

    const restored = await restoreTabs([
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
    ]);
    expect(restored).toBe(true);
    await discardObserved;

    const aTab = (await mock.chrome.tabs.query({ url: 'https://a.com' }))[0];
    const bTab = (await mock.chrome.tabs.query({ url: 'https://b.com' }))[0];
    expect(aTab?.discarded).toBe(false);
    expect(bTab?.discarded).toBe(true);
  });

  it('waits for real URL before discarding', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const tab = await mock.chrome.tabs.create({ url: 'about:blank' });
    const tabId = tab.id as number;

    const discardPromise = discardTabsBestEffort([tabId]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await mock.chrome.tabs.update(tabId, { url: 'https://example.com' });
    await discardPromise;

    const updated = await mock.chrome.tabs.get(tabId);
    expect(updated.discarded).toBe(true);
  });

  it('skips discards when setting is toggled off mid-restore', async () => {
    const mock = createMockChrome({
      initialStorage: {
        settings: { excludePinned: true, restoreBatchSize: 2, discardRestoredTabs: true, duplicateTabsPolicy: 'allow' },
      },
    });
    setMockChrome(mock.chrome);

    let listenerRegistered = false;
    const originalAddListener = mock.chrome.tabs.onUpdated.addListener;
    mock.chrome.tabs.onUpdated.addListener = (listener) => {
      listenerRegistered = true;
      originalAddListener(listener);
    };

    const tab = await mock.chrome.tabs.create({ url: 'about:blank' });
    const tabId = tab.id as number;

    const session = createDiscardSession();
    session.schedule([tabId]);

    await waitForPredicate(() => listenerRegistered);
    await writeSettings({ excludePinned: true, restoreBatchSize: 2, discardRestoredTabs: false });
    await mock.chrome.tabs.update(tabId, { url: 'https://example.com' });
    await Promise.resolve();

    const updated = await mock.chrome.tabs.get(tabId);
    expect(updated.discarded).toBe(false);
  });

  it('logs unexpected discard-session failures', async () => {
    const mock = createMockChrome({
      initialStorage: {
        settings: { excludePinned: true, restoreBatchSize: 2, discardRestoredTabs: true, duplicateTabsPolicy: 'allow' },
      },
    });
    setMockChrome(mock.chrome);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mock.chrome.tabs.onUpdated.addListener = () => {
      throw new Error('listener boom');
    };

    const tab = await mock.chrome.tabs.create({ url: 'about:blank' });
    const tabId = tab.id as number;

    const session = createDiscardSession();
    session.schedule([tabId]);

    await waitForPredicate(() =>
      warnSpy.mock.calls.some(([message]) => String(message).includes('Unexpected discard session failure')),
    );
    warnSpy.mockRestore();
  });

  it('uses fallback discard ids when window tabs are missing (reuse branch)', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 1, discardRestoredTabs: true });

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    const listTabId = window.tabs?.[0]?.id as number;
    mock.setCurrentTab(listTabId);

    const originalCreate = mock.chrome.windows.create;
    mock.chrome.windows.create = async (createData?: chrome.windows.CreateData) => {
      const created = await originalCreate(createData);
      // Drop the `tabs` payload to force the restore flow through query-based fallback verification/collection.
      return { id: created.id } as chrome.windows.Window;
    };

    const restored = await restoreTabs([
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
    ]);
    expect(restored).toBe(true);
  });

  it('fails restore when fallback verification lookup fails', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await writeSettings({ excludePinned: true, restoreBatchSize: 1, discardRestoredTabs: true });
    mock.chrome.windows.create = async () => ({ id: 7 } as chrome.windows.Window);
    mock.chrome.tabs.query = async () => {
      throw new Error('boom');
    };

    const restored = await restoreTabs([{ id: '1', url: 'https://a.com', title: 'A', savedAt: 1 }]);
    expect(restored).toBe(false);
  });

  it('ignores tab lookup failures during discard', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const tab = await mock.chrome.tabs.create({ url: 'about:blank' });
    const tabId = tab.id as number;
    const originalGet = mock.chrome.tabs.get;
    mock.chrome.tabs.get = async () => {
      throw new Error('boom');
    };

    await discardTabsBestEffort([tabId]);
    mock.chrome.tabs.get = originalGet;
    const updated = await mock.chrome.tabs.get(tabId);
    expect(updated.discarded).toBe(false);
  });

  it('ignores discard errors', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const tab = await mock.chrome.tabs.create({ url: 'https://example.com' });
    const tabId = tab.id as number;
    mock.chrome.tabs.discard = async () => {
      throw new Error('boom');
    };

    await discardTabsBestEffort([tabId]);
    const updated = await mock.chrome.tabs.get(tabId);
    expect(updated.discarded).toBe(false);
  });

  it('fails when window id is missing without reuse', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    mock.chrome.windows.create = async () => ({} as chrome.windows.Window);

    const restored = await restoreTabs([
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
    ]);
    expect(restored).toBe(false);
  });
});
