import { describe, expect, it } from 'vitest';
import { focusExistingListTabOrCreate, pickMostRecentListTab } from '../../entrypoints/background/list_tab';
import { LIST_PAGE_PATH } from '../../entrypoints/shared/storage';
import { createMockChrome } from '../helpers/mock_chrome';

describe('list tab focus', () => {
  it('picks most recently accessed tab', () => {
    const tabs = [
      { id: 1, lastAccessed: 10 },
      { id: 2, lastAccessed: 20 },
    ] as chrome.tabs.Tab[];
    expect(pickMostRecentListTab(tabs)?.id).toBe(2);
  });

  it('breaks ties using active tab', () => {
    const tabs = [
      { id: 1, lastAccessed: 10, active: false },
      { id: 2, lastAccessed: 10, active: true },
    ] as chrome.tabs.Tab[];
    expect(pickMostRecentListTab(tabs)?.id).toBe(2);
  });

  it('handles missing lastAccessed values', () => {
    const tabs = [
      { id: 1 },
      { id: 2, lastAccessed: 0, active: false },
    ] as chrome.tabs.Tab[];
    expect(pickMostRecentListTab(tabs)?.id).toBe(1);
  });

  it('creates a list tab when none exists', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const window = mock.createWindow(['https://a.com']);
    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    await focusExistingListTabOrCreate([], listUrl, window.id as number);

    const tabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    const listTabs = tabs.filter((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTabs).toHaveLength(1);
    expect(listTabs[0]?.pinned).toBe(true);
  });

  it('creates a list tab when no preferred window is provided', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    mock.createWindow(['https://a.com']);
    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    await focusExistingListTabOrCreate([], listUrl);

    const tabs = await mock.chrome.tabs.query({ url: listUrl });
    expect(tabs).toHaveLength(1);
  });

  it('reuses and focuses an existing list tab', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const window = mock.createWindow(['https://a.com']);
    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const listTabA = mock.createTab({ windowId: window.id as number, url: listUrl, active: false });
    const listTabB = mock.createTab({ windowId: window.id as number, url: listUrl, active: false });
    listTabA.lastAccessed = 10;
    listTabB.lastAccessed = 20;

    await focusExistingListTabOrCreate([listTabA, listTabB], listUrl, window.id as number);
    const updated = await mock.chrome.tabs.query({ windowId: window.id as number });
    const pinnedTab = updated.find((tab: chrome.tabs.Tab) => tab.url === listUrl && tab.pinned);
    expect(pinnedTab?.id).toBe(listTabB.id);
  });

  it('creates a new tab if focusing existing one fails', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const window = mock.createWindow(['https://a.com']);
    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const listTab = mock.createTab({ windowId: window.id as number, url: listUrl, active: false });
    mock.chrome.tabs.update = async () => {
      throw new Error('boom');
    };

    await focusExistingListTabOrCreate([listTab], listUrl, window.id as number);
    const tabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    const listTabs = tabs.filter((tab: chrome.tabs.Tab) => tab.url === listUrl);
    expect(listTabs.length).toBeGreaterThan(1);
  });

  it('handles create tab without id', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    const window = mock.createWindow(['https://a.com']);
    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    mock.chrome.tabs.create = async () => ({ windowId: window.id });

    await focusExistingListTabOrCreate([], listUrl, window.id as number);
    const tabs = await mock.chrome.tabs.query({ windowId: window.id as number });
    expect(tabs.length).toBeGreaterThan(0);
  });
});
