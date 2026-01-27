import { describe, expect, it } from 'vitest';
import { LIST_PAGE_PATH } from '../../entrypoints/shared/storage';
import { restoreTabs } from '../../entrypoints/nufftabs/restore';
import { writeSettings } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

describe('restore logic', () => {
  it('reuses list window when it is the only tab', async () => {
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

    const tabsInWindow = await mock.chrome.tabs.query({ windowId: window.id as number });
    const listTab = tabsInWindow.find((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTab?.active).toBe(true);
    const createdTabs = tabsInWindow.filter((tab: chrome.tabs.Tab) => tab.url !== listUrl);
    expect(createdTabs).toHaveLength(2);
    expect(createdTabs.map((tab: chrome.tabs.Tab) => tab.url)).toEqual(
      expect.arrayContaining(['https://a.com', 'https://b.com']),
    );
    expect(mock.windows.size).toBe(2);
    const cTab = (await mock.chrome.tabs.query({ url: 'https://c.com' }))[0];
    expect(cTab?.windowId).not.toBe(window.id);
  });

  it('creates new windows when reuse is not allowed', async () => {
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

  it('covers reuse branch window creation and rest tabs', async () => {
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

    expect(mock.windows.size).toBe(3);

    const listWindowTabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    expect(listWindowTabs.map((tab: chrome.tabs.Tab) => tab.url)).toEqual(
      expect.arrayContaining(['https://a.com', 'https://b.com', listUrl]),
    );

    const cTab = (await mock.chrome.tabs.query({ url: 'https://c.com' }))[0];
    const dTab = (await mock.chrome.tabs.query({ url: 'https://d.com' }))[0];
    const eTab = (await mock.chrome.tabs.query({ url: 'https://e.com' }))[0];

    expect(cTab?.windowId).toBeDefined();
    expect(dTab?.windowId).toBeDefined();
    expect(eTab?.windowId).toBeDefined();
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


