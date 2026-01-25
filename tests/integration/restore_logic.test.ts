import { describe, expect, it } from 'vitest';
import { LIST_PAGE_PATH } from '../../entrypoints/shared/storage';
import { restoreTabs } from '../../entrypoints/nufftabs/restore';
import { writeSettings } from '../../entrypoints/shared/storage';
import { createMockChrome } from '../helpers/mock_chrome';

describe('restore logic', () => {
  it('reuses list window when it is the only tab', async () => {
    const mock = createMockChrome();
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

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
    const createdTabs = tabsInWindow.filter((tab: chrome.tabs.Tab) => tab.url !== listUrl);
    expect(createdTabs).toHaveLength(2);
    expect(mock.windows.size).toBeGreaterThan(1);
  });

  it('creates new windows when reuse is not allowed', async () => {
    const mock = createMockChrome();
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

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
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

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
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

    const restored = await restoreTabs([]);
    expect(restored).toBe(true);
  });

  it('fails when window id is missing', async () => {
    const mock = createMockChrome();
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

    await writeSettings({ excludePinned: true, restoreBatchSize: 1 });
    mock.chrome.windows.create = async () => ({});

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
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

    await writeSettings({ excludePinned: true, restoreBatchSize: 2 });

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    mock.setCurrentTab(window.tabs?.[0]?.id as number);

    const savedTabs = [
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
      { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
      { id: '3', url: 'https://c.com', title: 'C', savedAt: 1 },
      { id: '4', url: 'https://d.com', title: 'D', savedAt: 1 },
    ];

    const restored = await restoreTabs(savedTabs);
    expect(restored).toBe(true);
  });

  it('handles getCurrent errors', async () => {
    const mock = createMockChrome();
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

    mock.chrome.tabs.getCurrent = async () => {
      throw new Error('boom');
    };

    const restored = await restoreTabs([{ id: '1', url: 'https://a.com', title: 'A', savedAt: 1 }]);
    expect(restored).toBe(true);
  });

  it('fails when window id is missing without reuse', async () => {
    const mock = createMockChrome();
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

    mock.chrome.windows.create = async () => ({});

    const restored = await restoreTabs([
      { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
    ]);
    expect(restored).toBe(false);
  });
});
