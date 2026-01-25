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
};

export type SettingsInput = {
  excludePinned: boolean;
  restoreBatchSize?: number;
};

export const STORAGE_KEYS = {
  savedTabs: 'savedTabs',
  settings: 'settings',
} as const;

export const DEFAULT_SETTINGS: Settings = {
  excludePinned: true,
  restoreBatchSize: 100,
};

export const LIST_PAGE_PATH = 'nufftabs.html';

export const UNKNOWN_GROUP_KEY = 'unknown';

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
  const parsedBatchSize =
    typeof restoreBatchSize === 'number' && Number.isFinite(restoreBatchSize)
      ? Math.floor(restoreBatchSize)
      : DEFAULT_SETTINGS.restoreBatchSize;
  return {
    excludePinned: typeof excludePinned === 'boolean' ? excludePinned : DEFAULT_SETTINGS.excludePinned,
    restoreBatchSize: parsedBatchSize > 0 ? parsedBatchSize : DEFAULT_SETTINGS.restoreBatchSize,
  };
}

export async function readSavedGroups(fallbackKey = UNKNOWN_GROUP_KEY): Promise<SavedTabGroups> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.savedTabs]);
    return normalizeSavedGroups(result[STORAGE_KEYS.savedTabs], fallbackKey);
  } catch {
    return {};
  }
}

export async function writeSavedGroups(savedTabs: SavedTabGroups): Promise<boolean> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.savedTabs]: savedTabs });
    return true;
  } catch {
    return false;
  }
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
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: payload });
    return true;
  } catch {
    return false;
  }
}
