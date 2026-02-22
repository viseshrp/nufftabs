import { describe, expect, it } from 'vitest';
import { condenseCurrentWindow } from '../../entrypoints/background/condense';
import { LIST_PAGE_PATH, STORAGE_KEYS, readSavedGroups } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

describe('background condense', () => {
  it('saves eligible tabs and focuses list tab', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const window = mock.createWindow(['https://a.com']);
    const windowId = window.id as number;
    mock.createTab({ windowId, url: 'https://b.com', pinned: true, active: false });

    await condenseCurrentWindow(windowId);

    const savedGroups = await readSavedGroups();
    const groupKeys = Object.keys(savedGroups);
    expect(groupKeys).toHaveLength(1);
    expect(groupKeys[0].startsWith(`${windowId}-`)).toBe(true);
    const savedGroup = savedGroups[groupKeys[0]] ?? [];
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
    setMockChrome(mock.chrome);

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
    setMockChrome(mock.chrome);

    const window = mock.createWindow(['https://a.com', 'https://b.com']);
    await condenseCurrentWindow(window.id as number);

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const tabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    const listTabs = tabs.filter((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTabs.length).toBe(1);
  });

  it('returns early when tabs query fails', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);
    const window = mock.createWindow(['https://a.com']);
    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    mock.chrome.tabs.query = async () => {
      throw new Error('boom');
    };

    await condenseCurrentWindow(window.id as number);

    expect(Object.keys(mock.storageData)).toHaveLength(0);
    expect(mock.tabs.size).toBe(1);
    const listTabs = Array.from(mock.tabs.values()).filter((tab) => tab.url === listUrl);
    expect(listTabs).toHaveLength(0);
    const existingTabs = Array.from(mock.tabs.values()).filter((tab) => tab.url === 'https://a.com');
    expect(existingTabs).toHaveLength(1);
  });

  it('handles storage write failures by focusing list tab', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);
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
    setMockChrome(mock.chrome);

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

  it('uses the unknown group key when window id cannot be resolved', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    mock.chrome.tabs.query = async (queryInfo: chrome.tabs.QueryInfo) => {
      if (queryInfo.url) return [];
      return [{ id: 1, url: 'https://a.com', title: 'A', pinned: false } as chrome.tabs.Tab];
    };

    await condenseCurrentWindow();

    const savedGroups = await readSavedGroups();
    const groupKeys = Object.keys(savedGroups);
    expect(groupKeys).toHaveLength(1);
    expect(groupKeys[0].startsWith('unknown-')).toBe(true);
    const savedGroup = savedGroups[groupKeys[0]] ?? [];
    expect(savedGroup).toHaveLength(1);
    expect(savedGroup[0]?.url).toBe('https://a.com');
  });

  it('handles list tab creation returning undefined', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const window = mock.createWindow(['https://a.com']);
    const originalCreate = mock.chrome.tabs.create;
    let createCount = 0;
    mock.chrome.tabs.create = async (createProperties: chrome.tabs.CreateProperties) => {
      createCount += 1;
      if (createCount === 1) return undefined as unknown as chrome.tabs.Tab;
      return originalCreate(createProperties);
    };

    await condenseCurrentWindow(window.id as number);

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const tabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    const listTabs = tabs.filter((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTabs.length).toBeGreaterThan(0);
  });

  it('handles tab creation and removal failures', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const window = mock.createWindow(['https://a.com']);
    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    mock.chrome.tabs.create = async () => {
      throw new Error('boom');
    };
    mock.chrome.tabs.remove = async () => {
      throw new Error('boom');
    };

    await condenseCurrentWindow(window.id as number);
    const savedGroups = await readSavedGroups();
    const groupKey = Object.keys(savedGroups).find((key) => key.startsWith(`${window.id}-`));
    expect(groupKey).toBeTruthy();
    const savedGroup = groupKey ? savedGroups[groupKey] : [];
    expect(savedGroup).toHaveLength(1);
    expect(savedGroup?.[0]?.url).toBe('https://a.com');
    expect(mock.tabs.size).toBe(1);
    const listTabs = Array.from(mock.tabs.values()).filter((tab) => tab.url === listUrl);
    expect(listTabs).toHaveLength(0);
  });

  it('creates a new group for each condense in the same window', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const window = mock.createWindow(['https://a.com']);
    const windowId = window.id as number;

    await condenseCurrentWindow(windowId);
    mock.createTab({ windowId, url: 'https://b.com', active: false });
    await condenseCurrentWindow(windowId);

    const savedGroups = await readSavedGroups();
    const windowKeys = Object.keys(savedGroups).filter((key) => key.startsWith(`${windowId}-`));
    expect(windowKeys).toHaveLength(2);
  });

  it('condenses 20+ tabs from one window without dropping entries', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const bulkUrls = Array.from({ length: 25 }, (_, index) => `https://bulk-condense.example/${index}`);
    const window = mock.createWindow(bulkUrls);
    await condenseCurrentWindow(window.id as number);

    const savedGroups = await readSavedGroups();
    const groupKey = Object.keys(savedGroups).find((key) => key.startsWith(`${window.id}-`));
    expect(groupKey).toBeTruthy();
    const savedGroup = groupKey ? savedGroups[groupKey] : [];
    expect(savedGroup).toHaveLength(25);
    const savedUrls = new Set(savedGroup?.map((tab) => tab.url));
    for (const url of bulkUrls) {
      expect(savedUrls.has(url)).toBe(true);
    }
  });

  it('silently skips duplicate URLs when duplicate rejection is enabled', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          excludePinned: true,
          duplicateTabsPolicy: 'reject',
        },
      },
    });
    setMockChrome(mock.chrome);

    const firstWindow = mock.createWindow(['https://dup.com']);
    const secondWindow = mock.createWindow(['https://dup.com', 'https://unique.com']);

    await condenseCurrentWindow(firstWindow.id as number);
    await condenseCurrentWindow(secondWindow.id as number);

    const savedGroups = await readSavedGroups();
    const allUrls = Object.values(savedGroups)
      .flat()
      .map((tab) => tab.url);
    expect(allUrls.filter((url) => url === 'https://dup.com')).toHaveLength(1);
    expect(allUrls).toContain('https://unique.com');

    // Duplicate tabs that were not saved should remain open in the source window.
    const secondWindowTabs = await mock.chrome.tabs.query({ windowId: secondWindow.id as number });
    expect(secondWindowTabs.some((tab) => tab.url === 'https://dup.com')).toBe(true);
    expect(secondWindowTabs.some((tab) => tab.url === 'https://unique.com')).toBe(false);
  });
});
