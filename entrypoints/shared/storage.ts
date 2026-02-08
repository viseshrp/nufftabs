export type SavedTab = {
  id: string;
  url: string;
  title: string;
  savedAt: number;
};

export type SavedTabGroups = Record<string, SavedTab[]>;

export type Settings = {
  excludePinned: boolean;
  restoreBatchSize: number;
  discardRestoredTabs: boolean;
  theme: 'os' | 'light' | 'dark';
};

export type SettingsInput = {
  excludePinned: boolean;
  restoreBatchSize?: number;
  discardRestoredTabs?: boolean;
  theme?: 'os' | 'light' | 'dark';
};

export const STORAGE_KEYS = {
  savedTabsIndex: 'savedTabsIndex',
  settings: 'settings',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  excludePinned: true,
  restoreBatchSize: 100,
  discardRestoredTabs: false,
  theme: 'os',
};

export const LIST_PAGE_PATH = 'nufftabs.html';

export const UNKNOWN_GROUP_KEY = 'unknown';

export const GROUP_KEY_PREFIX = 'savedTabs:';

type SavedTabInput = {
  url: string;
  title?: string;
  savedAt?: number;
  id?: string;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function createSavedTab(input: SavedTabInput): SavedTab {
  const savedAt = isFiniteNumber(input.savedAt) ? input.savedAt : Date.now();
  return {
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : crypto.randomUUID(),
    url: input.url,
    title: typeof input.title === 'string' && input.title.length > 0 ? input.title : input.url,
    savedAt,
  };
}

function normalizeSavedTab(value: unknown, now = Date.now()): SavedTab | null {
  if (!value || typeof value !== 'object') return null;
  const url = (value as { url?: unknown }).url;
  if (typeof url !== 'string' || url.length === 0) return null;

  const id = (value as { id?: unknown }).id;
  const title = (value as { title?: unknown }).title;
  const savedAt = (value as { savedAt?: unknown }).savedAt;

  return createSavedTab({
    url,
    id: typeof id === 'string' ? id : undefined,
    title: typeof title === 'string' ? title : undefined,
    savedAt: isFiniteNumber(savedAt) ? savedAt : now,
  });
}

function normalizeSavedTabArray(value: unknown, now = Date.now()): SavedTab[] {
  if (!Array.isArray(value)) return [];
  const normalized: SavedTab[] = [];
  for (const entry of value) {
    const tab = normalizeSavedTab(entry, now);
    if (tab) normalized.push(tab);
  }
  return normalized;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeIndex(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const index: string[] = [];
  for (const entry of value) {
    if (isNonEmptyString(entry)) index.push(entry);
  }
  return Array.from(new Set(index));
}

function groupStorageKey(groupKey: string): string {
  return `${GROUP_KEY_PREFIX}${groupKey}`;
}

export function isSavedGroupStorageKey(key: string): boolean {
  return key.startsWith(GROUP_KEY_PREFIX);
}

async function readSavedGroupsIndex(): Promise<string[]> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.savedTabsIndex]);
  return normalizeIndex(result[STORAGE_KEYS.savedTabsIndex]);
}

async function writeAllGroupsInternal(savedTabs: SavedTabGroups, existingIndex: string[]): Promise<void> {
  const entries = Object.entries(savedTabs).filter(([, tabs]) => tabs.length > 0);
  const nextIndex = entries.map(([key]) => key);
  const payload: Record<string, unknown> = {
    [STORAGE_KEYS.savedTabsIndex]: nextIndex,
  };
  for (const [key, tabs] of entries) {
    payload[groupStorageKey(key)] = tabs;
  }

  await chrome.storage.local.set(payload);

  const removedKeys: string[] = [];
  for (const key of existingIndex) {
    if (!nextIndex.includes(key)) removedKeys.push(groupStorageKey(key));
  }
  if (removedKeys.length > 0) {
    await chrome.storage.local.remove(removedKeys);
  }
}

export function normalizeSavedGroups(value: unknown, fallbackKey = UNKNOWN_GROUP_KEY): SavedTabGroups {
  const now = Date.now();
  if (Array.isArray(value)) {
    const tabs = normalizeSavedTabArray(value, now);
    return tabs.length > 0 ? { [fallbackKey]: tabs } : {};
  }
  if (!value || typeof value !== 'object') return {};
  const groups: SavedTabGroups = {};
  for (const [key, group] of Object.entries(value as Record<string, unknown>)) {
    const tabs = normalizeSavedTabArray(group, now);
    if (tabs.length > 0) groups[key] = tabs;
  }
  return groups;
}

export function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const excludePinned = (value as { excludePinned?: unknown }).excludePinned;
  const restoreBatchSize = (value as { restoreBatchSize?: unknown }).restoreBatchSize;
  const discardRestoredTabs = (value as { discardRestoredTabs?: unknown }).discardRestoredTabs;
  const theme = (value as { theme?: unknown }).theme;

  const parsedBatchSize =
    typeof restoreBatchSize === 'number' && Number.isFinite(restoreBatchSize)
      ? Math.floor(restoreBatchSize)
      : DEFAULT_SETTINGS.restoreBatchSize;

  const parsedTheme =
    typeof theme === 'string' && ['os', 'light', 'dark'].includes(theme)
      ? (theme as Settings['theme'])
      : DEFAULT_SETTINGS.theme;

  return {
    excludePinned: typeof excludePinned === 'boolean' ? excludePinned : DEFAULT_SETTINGS.excludePinned,
    restoreBatchSize: parsedBatchSize > 0 ? parsedBatchSize : DEFAULT_SETTINGS.restoreBatchSize,
    discardRestoredTabs:
      typeof discardRestoredTabs === 'boolean' ? discardRestoredTabs : DEFAULT_SETTINGS.discardRestoredTabs,
    theme: parsedTheme,
  };
}

export async function readSavedGroups(_fallbackKey = UNKNOWN_GROUP_KEY): Promise<SavedTabGroups> {
  try {
    const index = await readSavedGroupsIndex();
    if (index.length === 0) return {};
    const groupKeys = index.map((key) => groupStorageKey(key));
    const result = await chrome.storage.local.get(groupKeys);
    const groups: SavedTabGroups = {};
    const now = Date.now();
    for (const key of index) {
      const tabs = normalizeSavedTabArray(result[groupStorageKey(key)], now);
      if (tabs.length > 0) groups[key] = tabs;
    }
    return groups;
  } catch {
    return {};
  }
}

export async function writeSavedGroups(savedTabs: SavedTabGroups): Promise<boolean> {
  try {
    const existingIndex = await readSavedGroupsIndex();
    await writeAllGroupsInternal(savedTabs, existingIndex);
    return true;
  } catch {
    return false;
  }
}

export async function readSavedGroup(groupKey: string): Promise<SavedTab[]> {
  try {
    const result = await chrome.storage.local.get([groupStorageKey(groupKey)]);
    return normalizeSavedTabArray(result[groupStorageKey(groupKey)]);
  } catch {
    return [];
  }
}

export async function writeSavedGroup(groupKey: string, tabs: SavedTab[]): Promise<boolean> {
  try {
    const index = await readSavedGroupsIndex();
    const hasGroup = index.includes(groupKey);
    let nextIndex = index;
    if (tabs.length > 0) {
      if (!hasGroup) nextIndex = [...index, groupKey];
      await chrome.storage.local.set({
        [STORAGE_KEYS.savedTabsIndex]: nextIndex,
        [groupStorageKey(groupKey)]: tabs,
      });
    } else {
      if (hasGroup) nextIndex = index.filter((key) => key !== groupKey);
      await chrome.storage.local.set({ [STORAGE_KEYS.savedTabsIndex]: nextIndex });
      await chrome.storage.local.remove(groupStorageKey(groupKey));
    }
    return true;
  } catch {
    return false;
  }
}

export async function appendSavedGroup(
  groupKey: string,
  tabs: SavedTab[],
  maxAttempts = 3,
): Promise<boolean> {
  if (tabs.length === 0) return false;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const index = await readSavedGroupsIndex();
      const merged = Array.from(new Set([...index, groupKey]));
      // Always write the merged index to reduce lost updates under concurrent writes.
      await chrome.storage.local.set({
        [STORAGE_KEYS.savedTabsIndex]: merged,
        [groupStorageKey(groupKey)]: tabs,
      });
      const verified = await readSavedGroupsIndex();
      const stabilized = Array.from(new Set([...verified, groupKey]));
      // Reconcile if a concurrent write dropped our key from the index.
      if (stabilized.length !== verified.length) {
        await chrome.storage.local.set({ [STORAGE_KEYS.savedTabsIndex]: stabilized });
        const finalIndex = await readSavedGroupsIndex();
        if (finalIndex.includes(groupKey)) return true;
      } else if (verified.includes(groupKey)) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export async function readSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.settings]);
    return normalizeSettings(result[STORAGE_KEYS.settings]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings: SettingsInput): Promise<boolean> {
  try {
    const payload: SettingsInput = { excludePinned: settings.excludePinned };
    if (
      typeof settings.restoreBatchSize === 'number' &&
      Number.isFinite(settings.restoreBatchSize) &&
      settings.restoreBatchSize > 0
    ) {
      payload.restoreBatchSize = Math.floor(settings.restoreBatchSize);
    }
    if (typeof settings.discardRestoredTabs === 'boolean') {
      payload.discardRestoredTabs = settings.discardRestoredTabs;
    }
    if (
      typeof settings.theme === 'string' &&
      ['os', 'light', 'dark'].includes(settings.theme)
    ) {
      payload.theme = settings.theme;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: payload });
    return true;
  } catch {
    return false;
  }
}
