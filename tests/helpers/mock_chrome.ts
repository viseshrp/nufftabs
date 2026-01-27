export type MockTab = chrome.tabs.Tab;
export type MockWindow = chrome.windows.Window;

type StorageValue = unknown;
type StorageRecord = Record<string, StorageValue>;
type StorageGetKeys = string | string[] | StorageRecord | null | undefined;

type StorageListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: 'local' | 'sync' | 'managed' | 'session',
) => void;

export type MockChrome = {
  runtime: {
    getURL: (path: string) => string;
    onMessage: { addListener: (handler?: unknown) => void };
  };
  action: { onClicked: { addListener: (handler?: unknown) => void } };
  storage: {
    local: {
      get: (keys: StorageGetKeys) => Promise<StorageRecord>;
      set: (payload: StorageRecord) => Promise<void>;
      remove: (keys: string | string[]) => Promise<void>;
    };
    sync: {
      get: (keys: StorageGetKeys) => Promise<StorageRecord>;
      set: (payload: StorageRecord) => Promise<void>;
      remove: (keys: string | string[]) => Promise<void>;
    };
    onChanged: {
      addListener: (listener: StorageListener) => void;
      removeListener: (listener: StorageListener) => void;
    };
  };
  tabs: {
    query: (queryInfo: chrome.tabs.QueryInfo) => Promise<MockTab[]>;
    create: (createProperties: chrome.tabs.CreateProperties) => Promise<MockTab>;
    update: (tabId: number, updateProperties: chrome.tabs.UpdateProperties) => Promise<MockTab>;
    remove: (tabIds: number | number[]) => Promise<void>;
    getCurrent: () => Promise<MockTab | null>;
  };
  windows: {
    create: (createData?: chrome.windows.CreateData) => Promise<MockWindow>;
    update: (windowId: number, updateInfo: chrome.windows.UpdateInfo) => Promise<MockWindow>;
  };
};

export type MockDefineBackground = (callback: () => void) => void;

export function setMockChrome(mockChrome: MockChrome): void {
  Object.defineProperty(globalThis, 'chrome', {
    value: mockChrome,
    configurable: true,
    writable: true,
  });
}

export function setMockDefineBackground(handler: MockDefineBackground): void {
  Object.defineProperty(globalThis, 'defineBackground', {
    value: handler,
    configurable: true,
    writable: true,
  });
}

export function createMockChrome(options?: { initialStorage?: StorageRecord }) {
  const storageData: StorageRecord = { ...(options?.initialStorage ?? {}) };
  const storageListeners = new Set<StorageListener>();

  const windows = new Map<number, MockWindow>();
  const tabs = new Map<number, MockTab>();
  let nextWindowId = 1;
  let nextTabId = 1;
  let currentWindowId: number | undefined;
  let currentTabId: number | undefined;

  const ensureWindow = (windowId?: number) => {
    if (typeof windowId === 'number' && windows.has(windowId)) return windowId;
    const id = nextWindowId++;
    windows.set(id, { id, focused: true } as MockWindow);
    if (typeof currentWindowId !== 'number') currentWindowId = id;
    return id;
  };

  const addTabToWindow = (tab: MockTab, windowId: number) => {
    tab.windowId = windowId;
    tabs.set(tab.id as number, tab);
  };

  const createTab = (params: chrome.tabs.CreateProperties): MockTab => {
    const windowId = ensureWindow(params.windowId);
    const tab: MockTab = {
      id: nextTabId++,
      windowId,
      url: params.url ?? 'about:blank',
      title: params.url ?? 'about:blank',
      pinned: Boolean(params.pinned),
      active: params.active !== false,
      lastAccessed: Date.now(),
    } as MockTab;

    if (tab.active) {
      for (const existing of tabs.values()) {
        if (existing.windowId === windowId) existing.active = false;
      }
      currentWindowId = windowId;
      currentTabId = tab.id as number;
    }

    addTabToWindow(tab, windowId);
    return tab;
  };

  const createWindow = (urls?: string | string[]) => {
    const id = ensureWindow();
    currentWindowId = id;
    windows.set(id, { id, focused: true } as MockWindow);
    const urlList = typeof urls === 'string' ? [urls] : Array.isArray(urls) ? urls : ['about:blank'];
    const createdTabs = urlList.map((url, index) =>
      createTab({ windowId: id, url, active: index === 0 }),
    );
    return { id, tabs: createdTabs } as MockWindow;
  };

  const storageArea = {
    async get(keys: StorageGetKeys) {
      if (Array.isArray(keys)) {
        return keys.reduce((acc, key) => {
          if (Object.hasOwn(storageData, key)) {
            acc[key] = storageData[key];
          }
          return acc;
        }, {} as StorageRecord);
      }
      if (typeof keys === 'string') {
        if (Object.hasOwn(storageData, keys)) {
          return { [keys]: storageData[keys] } as StorageRecord;
        }
        return {} as StorageRecord;
      }
      if (keys && typeof keys === 'object') {
        return Object.keys(keys).reduce((acc, key) => {
          acc[key] = Object.hasOwn(storageData, key)
            ? storageData[key]
            : (keys as StorageRecord)[key];
          return acc;
        }, {} as StorageRecord);
      }
      return { ...storageData } as StorageRecord;
    },
    async set(payload: StorageRecord) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [key, value] of Object.entries(payload)) {
        changes[key] = { oldValue: storageData[key], newValue: value };
        storageData[key] = value;
      }
      for (const listener of storageListeners) {
        listener(changes, 'local');
      }
    },
    async remove(keys: string | string[]) {
      const keysToRemove = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const key of keysToRemove) {
        if (key in storageData) {
          changes[key] = { oldValue: storageData[key], newValue: undefined };
          delete storageData[key];
        }
      }
      for (const listener of storageListeners) {
        listener(changes, 'local');
      }
    },
  };

  const chrome: MockChrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://mock/${path}`,
      onMessage: {
        addListener: () => undefined,
      },
    },
    action: {
      onClicked: {
        addListener: () => undefined,
      },
    },
    storage: {
      local: storageArea,
      sync: storageArea,
      onChanged: {
        addListener: (listener: StorageListener) => {
          storageListeners.add(listener);
        },
        removeListener: (listener: StorageListener) => {
          storageListeners.delete(listener);
        },
      },
    },
    tabs: {
      async query(queryInfo: chrome.tabs.QueryInfo) {
        let results = Array.from(tabs.values());
        if (queryInfo.url) {
          const urls = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url];
          results = results.filter((tab) => typeof tab.url === 'string' && urls.includes(tab.url));
        }
        if (typeof queryInfo.windowId === 'number') {
          results = results.filter((tab) => tab.windowId === queryInfo.windowId);
        }
        if (queryInfo.currentWindow) {
          results = results.filter((tab) => tab.windowId === currentWindowId);
        }
        return results;
      },
      async create(createProperties: chrome.tabs.CreateProperties) {
        return createTab(createProperties);
      },
      async update(tabId: number, updateProperties: chrome.tabs.UpdateProperties) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error('Tab not found');
        if (typeof updateProperties.active === 'boolean') {
          if (updateProperties.active) {
            for (const existing of tabs.values()) {
              if (existing.windowId === tab.windowId) existing.active = false;
            }
            tab.active = true;
            currentWindowId = tab.windowId as number;
            currentTabId = tab.id as number;
            tab.lastAccessed = Date.now();
          } else {
            tab.active = false;
          }
        }
        if (typeof updateProperties.pinned === 'boolean') {
          tab.pinned = updateProperties.pinned;
        }
        return tab;
      },
      async remove(tabIds: number | number[]) {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
        for (const id of ids) {
          tabs.delete(id);
        }
      },
      async getCurrent() {
        if (typeof currentTabId === 'number') return tabs.get(currentTabId) ?? null;
        return null;
      },
    },
    windows: {
      async create(createData?: chrome.windows.CreateData) {
        const window = createWindow(createData?.url as string | string[] | undefined);
        return window;
      },
      async update(windowId: number, updateInfo: chrome.windows.UpdateInfo) {
        const window = windows.get(windowId);
        if (!window) throw new Error('Window not found');
        if (typeof updateInfo.focused === 'boolean') window.focused = updateInfo.focused;
        if (updateInfo.focused) currentWindowId = windowId;
        return window;
      },
    },
  };

  const api = {
    chrome,
    storageData,
    tabs,
    windows,
    createTab,
    createWindow,
    setCurrentTab(tabId: number) {
      currentTabId = tabId;
      const tab = tabs.get(tabId);
      if (tab?.windowId) currentWindowId = tab.windowId;
    },
    getCurrentWindowId() {
      return currentWindowId;
    },
  };

  return api;
}
