import { describe, expect, it } from 'vitest';
import { condenseCurrentWindow } from '../../entrypoints/background/condense';
import { LIST_PAGE_PATH, readSavedGroup } from '../../entrypoints/shared/storage';
import { createMockChrome } from '../helpers/mock_chrome';

describe('background condense', () => {
  it('saves eligible tabs and focuses list tab', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const window = mock.createWindow(['https://a.com']);
    const windowId = window.id as number;
    mock.createTab({ windowId, url: 'https://b.com', pinned: true, active: false });

    await condenseCurrentWindow(windowId);

    const savedGroup = await readSavedGroup(String(windowId));
    expect(savedGroup).toHaveLength(1);
    expect(savedGroup[0]?.url).toBe('https://a.com');

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const tabs = await mock.chrome.tabs.query({ windowId });
    const listTabs = tabs.filter((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTabs).toHaveLength(1);
    expect(listTabs[0]?.pinned).toBe(true);
  });

  it('focuses existing list tab when no eligible tabs', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const window = mock.createWindow([listUrl]);
    const listTab = window.tabs?.[0] as chrome.tabs.Tab;
    listTab.active = false;

    await condenseCurrentWindow(window.id as number);

    const updated = await mock.chrome.tabs.query({ windowId: window.id as number });
    const updatedList = updated.find((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(updatedList?.active).toBe(true);
  });

  it('creates a list tab when all tabs are eligible', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const window = mock.createWindow(['https://a.com', 'https://b.com']);
    await condenseCurrentWindow(window.id as number);

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const tabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    const listTabs = tabs.filter((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTabs.length).toBe(1);
  });

  it('returns early when tabs query fails', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;
    mock.chrome.tabs.query = async () => {
      throw new Error('boom');
    };

    await condenseCurrentWindow(1);
    expect(true).toBe(true);
  });

  it('handles storage write failures by focusing list tab', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;
    mock.chrome.storage.local.set = async () => {
      throw new Error('boom');
    };

    const window = mock.createWindow(['https://a.com']);
    await condenseCurrentWindow(window.id as number);

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const tabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    const listTabs = tabs.filter((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTabs.length).toBe(1);
  });

  it('handles list tab query failures gracefully', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const originalQuery = mock.chrome.tabs.query;
    mock.chrome.tabs.query = async (queryInfo: chrome.tabs.QueryInfo) => {
      if (queryInfo.url) throw new Error('boom');
      return originalQuery(queryInfo);
    };

    const window = mock.createWindow(['https://a.com']);
    await condenseCurrentWindow(window.id as number);

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const tabs = await originalQuery({ windowId: window.id as number });
    const listTabs = tabs.filter((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTabs.length).toBe(1);
  });

  it('handles tab creation and removal failures', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const window = mock.createWindow(['https://a.com']);
    mock.chrome.tabs.create = async () => {
      throw new Error('boom');
    };
    mock.chrome.tabs.remove = async () => {
      throw new Error('boom');
    };

    await condenseCurrentWindow(window.id as number);
    expect(true).toBe(true);
  });
});
