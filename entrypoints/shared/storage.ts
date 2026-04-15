/**
 * Persistence layer for saved tab groups and extension settings.
 * All data is stored in `chrome.storage.local` using a two-level scheme:
 *   • An index array (`savedTabsIndex`) listing group keys.
 *   • Individual group entries keyed as `savedTabs:<groupKey>`.
 *   • Per-group metadata entries keyed as `savedTabGroupMetadata:<groupKey>`.
 */
import { logExtensionError } from './utils';

/** A single tab persisted by the extension. */
export type SavedTab = {
  /** Unique identifier (UUID) for this saved tab entry. */
  id: string;
  url: string;
  title: string;
  /** Epoch-ms timestamp of when the tab was condensed/imported. */
  savedAt: number;
};

/** Map of group-key → array of saved tabs. Each key represents one condense session. */
export type SavedTabGroups = Record<string, SavedTab[]>;

/** Metadata for one saved-tab group. Keep this small because it loads with the index. */
export type SavedTabGroupMeta = {
  /** Pinned groups sort before unpinned groups in the list page. */
  pinned: boolean;
};

/** Map of group-key → metadata. Missing keys use default unpinned behavior. */
export type SavedTabGroupMetadata = Record<string, SavedTabGroupMeta>;

/** Fully resolved extension settings with all fields guaranteed present. */
export type Settings = {
  /** Whether pinned tabs are excluded from condense operations. */
  excludePinned: boolean;
  /** Maximum number of tabs to restore per browser window. */
  restoreBatchSize: number;
  /** When true, restored tabs are immediately discarded to save RAM. */
  discardRestoredTabs: boolean;
  /** UI color scheme: follow OS, force light, or force dark. */
  theme: 'os' | 'light' | 'dark';
  /** Duplicate-tab handling mode for condense/import flows. */
  duplicateTabsPolicy: DuplicateTabsPolicy;
};

/** Supported duplicate handling modes for newly saved tabs. */
export type DuplicateTabsPolicy = 'allow' | 'reject';

/** Partial settings input used when writing user preferences; missing fields keep defaults. */
export type SettingsInput = {
  excludePinned: boolean;
  restoreBatchSize?: number;
  discardRestoredTabs?: boolean;
  theme?: 'os' | 'light' | 'dark';
  duplicateTabsPolicy?: DuplicateTabsPolicy;
};

/** Top-level keys used in `chrome.storage.local`. */
export const STORAGE_KEYS = {
  savedTabsIndex: 'savedTabsIndex',
  /** Legacy aggregate metadata map retained as a read fallback for older persisted data. */
  savedTabGroupMetadata: 'savedTabGroupMetadata',
  settings: 'settings',
} as const;

/** Fallback settings applied when stored values are missing or invalid. */
export const DEFAULT_SETTINGS: Settings = {
  excludePinned: true,
  restoreBatchSize: 100,
  discardRestoredTabs: false,
  theme: 'os',
  duplicateTabsPolicy: 'allow',
};

/** Relative path to the main list page used by `chrome.runtime.getURL`. */
export const LIST_PAGE_PATH = 'nufftabs.html';

/** Fallback group key when the originating window ID is unavailable. */
export const UNKNOWN_GROUP_KEY = 'unknown';

/** Storage key prefix prepended to each group key for individual group entries. */
export const GROUP_KEY_PREFIX = 'savedTabs:';

/** Storage key prefix prepended to each group key for per-group metadata entries. */
export const GROUP_METADATA_KEY_PREFIX = 'savedTabGroupMetadata:';

/** Input shape accepted by `createSavedTab`; optional fields receive generated defaults. */
type SavedTabInput = {
  url: string;
  title?: string;
  savedAt?: number;
  id?: string;
};

/** Type-guard that narrows `unknown` to a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Creates a `SavedTab` with a generated UUID and sensible defaults for missing fields. */
export function createSavedTab(input: SavedTabInput): SavedTab {
  const savedAt = isFiniteNumber(input.savedAt) ? input.savedAt : Date.now();
  return {
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : crypto.randomUUID(),
    url: input.url,
    title: typeof input.title === 'string' && input.title.length > 0 ? input.title : input.url,
    savedAt,
  };
}

/** Attempts to coerce an unknown value into a valid `SavedTab`, returning null on failure. */
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

/** Normalizes an unknown value into an array of valid `SavedTab` objects, dropping invalid entries. */
function normalizeSavedTabArray(value: unknown, now = Date.now()): SavedTab[] {
  if (!Array.isArray(value)) return [];
  const normalized: SavedTab[] = [];
  for (const entry of value) {
    const tab = normalizeSavedTab(entry, now);
    if (tab) normalized.push(tab);
  }
  return normalized;
}

/** Type-guard that narrows `unknown` to a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Coerces an unknown value into a deduplicated array of non-empty group key strings. */
function normalizeIndex(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const index: string[] = [];
  for (const entry of value) {
    if (isNonEmptyString(entry)) index.push(entry);
  }
  return Array.from(new Set(index));
}

/** Coerces one unknown metadata entry into a supported group metadata object. */
function normalizeSavedGroupMeta(value: unknown): SavedTabGroupMeta | null {
  // Accept compact `true` entries as a defensive migration/import path.
  if (value === true) return { pinned: true };
  if (!value || typeof value !== 'object') return null;

  const pinned = (value as { pinned?: unknown }).pinned;
  return pinned === true ? { pinned: true } : null;
}

/** Internal read state for one per-group metadata key, including migration tombstones. */
type StoredSavedGroupMetaState = SavedTabGroupMeta | 'unpinned' | null;

/** Coerces one per-group metadata entry and preserves explicit unpin tombstones. */
function normalizeStoredSavedGroupMeta(value: unknown): StoredSavedGroupMetaState {
  // `false` is accepted as a compact tombstone for defensive forward compatibility.
  if (value === false) return 'unpinned';
  if (value === true) return { pinned: true };
  if (!value || typeof value !== 'object') return null;

  const pinned = (value as { pinned?: unknown }).pinned;
  if (pinned === false) return 'unpinned';
  return pinned === true ? { pinned: true } : null;
}

/** Normalizes a metadata map, dropping unknown flags and unpinned entries. */
export function normalizeSavedGroupMetadata(value: unknown): SavedTabGroupMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const metadata: SavedTabGroupMetadata = {};
  for (const [groupKey, rawMeta] of Object.entries(value as Record<string, unknown>)) {
    if (!isNonEmptyString(groupKey)) continue;
    const normalized = normalizeSavedGroupMeta(rawMeta);
    if (normalized) metadata[groupKey] = normalized;
  }
  return metadata;
}

/**
 * Filters metadata to active group keys.
 * This prevents stale pin flags from surviving after group deletes or replace imports.
 */
export function filterSavedGroupMetadataForKeys(
  metadata: SavedTabGroupMetadata,
  groupKeys: Iterable<string>,
): SavedTabGroupMetadata {
  const allowedKeys = new Set(groupKeys);
  const filtered: SavedTabGroupMetadata = {};
  for (const [groupKey, groupMeta] of Object.entries(metadata)) {
    if (allowedKeys.has(groupKey) && groupMeta.pinned) {
      filtered[groupKey] = { pinned: true };
    }
  }
  return filtered;
}

/** Returns the `chrome.storage.local` key for a given group key. */
function groupStorageKey(groupKey: string): string {
  return `${GROUP_KEY_PREFIX}${groupKey}`;
}

/** Returns the `chrome.storage.local` metadata key for a saved-tab group key. */
export function savedGroupMetadataStorageKey(groupKey: string): string {
  return `${GROUP_METADATA_KEY_PREFIX}${groupKey}`;
}

/** Returns true if the storage key represents an individual saved-tab group entry. */
export function isSavedGroupStorageKey(key: string): boolean {
  return key.startsWith(GROUP_KEY_PREFIX);
}

/** Returns true if the storage key represents an individual saved-tab group metadata entry. */
export function isSavedGroupMetadataStorageKey(key: string): boolean {
  return key.startsWith(GROUP_METADATA_KEY_PREFIX);
}

/** Reads the ordered list of group keys from storage. */
export async function readSavedGroupsIndex(): Promise<string[]> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.savedTabsIndex]);
  return normalizeIndex(result[STORAGE_KEYS.savedTabsIndex]);
}

/** Reads pinned-group metadata from storage, returning an empty map on failure. */
export async function readSavedGroupMetadata(): Promise<SavedTabGroupMetadata> {
  try {
    const index = await readSavedGroupsIndex();
    if (index.length === 0) return {};

    const metadataKeys = index.map((groupKey) => savedGroupMetadataStorageKey(groupKey));
    const result = await chrome.storage.local.get([STORAGE_KEYS.savedTabGroupMetadata, ...metadataKeys]);
    const metadata = filterSavedGroupMetadataForKeys(
      normalizeSavedGroupMetadata(result[STORAGE_KEYS.savedTabGroupMetadata]),
      index,
    );

    for (const groupKey of index) {
      const storedMeta = normalizeStoredSavedGroupMeta(result[savedGroupMetadataStorageKey(groupKey)]);
      if (storedMeta === 'unpinned') {
        // Per-group tombstones override legacy aggregate pins during migration.
        delete metadata[groupKey];
      } else if (storedMeta) {
        metadata[groupKey] = storedMeta;
      }
    }
    return metadata;
  } catch (error) {
    logExtensionError('Failed to read saved group metadata', error, { operation: 'runtime_context' });
    return {};
  }
}

/** Adds exact per-group metadata writes to an existing storage payload. */
function applyGroupMetadataPayload(
  payload: Record<string, unknown>,
  groupMetadata: SavedTabGroupMetadata,
  groupKeys: string[],
): void {
  const nextMetadata = filterSavedGroupMetadataForKeys(groupMetadata, groupKeys);
  for (const groupKey of groupKeys) {
    payload[savedGroupMetadataStorageKey(groupKey)] = nextMetadata[groupKey] ?? { pinned: false };
  }
}

/** Atomically writes all groups to storage and removes stale group entries. */
async function writeAllGroupsInternal(
  savedTabs: SavedTabGroups,
  existingIndex: string[],
  groupMetadata?: SavedTabGroupMetadata,
): Promise<void> {
  const entries = Object.entries(savedTabs).filter(([, tabs]) => tabs.length > 0);
  const nextIndex = entries.map(([key]) => key);
  const nextIndexSet = new Set(nextIndex);
  const payload: Record<string, unknown> = {
    [STORAGE_KEYS.savedTabsIndex]: nextIndex,
  };
  if (groupMetadata) applyGroupMetadataPayload(payload, groupMetadata, nextIndex);
  for (const [key, tabs] of entries) {
    payload[groupStorageKey(key)] = tabs;
  }

  await chrome.storage.local.set(payload);

  const removedKeys: string[] = [];
  for (const key of existingIndex) {
    if (!nextIndexSet.has(key)) {
      removedKeys.push(groupStorageKey(key), savedGroupMetadataStorageKey(key));
    }
  }
  if (removedKeys.length > 0) {
    await chrome.storage.local.remove(removedKeys);
  }
}

/** Coerces an unknown value into a valid `SavedTabGroups` map, using `fallbackKey` for flat arrays. */
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

/** Parses and validates an unknown value into fully resolved `Settings`, filling in defaults. */
export function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const excludePinned = (value as { excludePinned?: unknown }).excludePinned;
  const restoreBatchSize = (value as { restoreBatchSize?: unknown }).restoreBatchSize;
  const discardRestoredTabs = (value as { discardRestoredTabs?: unknown }).discardRestoredTabs;
  const theme = (value as { theme?: unknown }).theme;
  const duplicateTabsPolicy = (value as { duplicateTabsPolicy?: unknown }).duplicateTabsPolicy;

  const parsedBatchSize =
    typeof restoreBatchSize === 'number' && Number.isFinite(restoreBatchSize)
      ? Math.floor(restoreBatchSize)
      : DEFAULT_SETTINGS.restoreBatchSize;

  const parsedTheme =
    typeof theme === 'string' && ['os', 'light', 'dark'].includes(theme)
      ? (theme as Settings['theme'])
      : DEFAULT_SETTINGS.theme;
  const parsedDuplicateTabsPolicy =
    duplicateTabsPolicy === 'allow' || duplicateTabsPolicy === 'reject'
      ? duplicateTabsPolicy
      : DEFAULT_SETTINGS.duplicateTabsPolicy;

  return {
    excludePinned: typeof excludePinned === 'boolean' ? excludePinned : DEFAULT_SETTINGS.excludePinned,
    restoreBatchSize: parsedBatchSize > 0 ? parsedBatchSize : DEFAULT_SETTINGS.restoreBatchSize,
    discardRestoredTabs:
      typeof discardRestoredTabs === 'boolean' ? discardRestoredTabs : DEFAULT_SETTINGS.discardRestoredTabs,
    theme: parsedTheme,
    duplicateTabsPolicy: parsedDuplicateTabsPolicy,
  };
}

/** Reads all saved tab groups from storage, normalizing each group's tab array. */
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
  } catch (error) {
    logExtensionError('Failed to read saved groups', error, { operation: 'runtime_context' });
    return {};
  }
}

/** Replaces all saved groups and optional group metadata in storage, returning true on success. */
export async function writeSavedGroups(
  savedTabs: SavedTabGroups,
  groupMetadata?: SavedTabGroupMetadata,
): Promise<boolean> {
  try {
    const existingIndex = await readSavedGroupsIndex();
    await writeAllGroupsInternal(savedTabs, existingIndex, groupMetadata);
    return true;
  } catch (error) {
    logExtensionError('Failed to write saved groups', error, { operation: 'runtime_context' });
    return false;
  }
}

/** Reads a single group's tab array from storage by its group key. */
export async function readSavedGroup(groupKey: string): Promise<SavedTab[]> {
  try {
    const result = await chrome.storage.local.get([groupStorageKey(groupKey)]);
    return normalizeSavedTabArray(result[groupStorageKey(groupKey)]);
  } catch (error) {
    logExtensionError(`Failed to read saved tab group (${groupKey})`, error, { operation: 'runtime_context' });
    return [];
  }
}

/** Writes a single group to storage, updating the index. An empty array removes the group. */
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
      await chrome.storage.local.set({
        [STORAGE_KEYS.savedTabsIndex]: nextIndex,
      });
      await chrome.storage.local.remove([groupStorageKey(groupKey), savedGroupMetadataStorageKey(groupKey)]);
    }
    return true;
  } catch (error) {
    logExtensionError(`Failed to write saved tab group (${groupKey})`, error, { operation: 'runtime_context' });
    return false;
  }
}

/**
 * Appends a new group to storage with optimistic concurrency control.
 * Retries up to `maxAttempts` times if a concurrent write drops the key from the index.
 */
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
    } catch (error) {
      logExtensionError(`Failed to append saved tab group (${groupKey})`, error, { operation: 'runtime_context' });
      return false;
    }
  }
  return false;
}

/** Updates one group's pinned flag without loading or rewriting that group's tab payload. */
export async function writeSavedGroupPinned(groupKey: string, pinned: boolean): Promise<boolean> {
  try {
    const index = await readSavedGroupsIndex();
    if (!index.includes(groupKey)) return false;

    await chrome.storage.local.set({
      [savedGroupMetadataStorageKey(groupKey)]: pinned ? { pinned: true } : { pinned: false },
    });
    return true;
  } catch (error) {
    logExtensionError(`Failed to write saved group pin state (${groupKey})`, error, { operation: 'runtime_context' });
    return false;
  }
}

/** Reads the user's extension settings from storage, returning defaults on failure. */
export async function readSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEYS.settings]);
    return normalizeSettings(result[STORAGE_KEYS.settings]);
  } catch (error) {
    logExtensionError('Failed to read settings', error, { operation: 'runtime_context' });
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persists the given settings input to storage, returning true on success. */
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
    if (settings.duplicateTabsPolicy === 'allow' || settings.duplicateTabsPolicy === 'reject') {
      payload.duplicateTabsPolicy = settings.duplicateTabsPolicy;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: payload });
    return true;
  } catch (error) {
    logExtensionError('Failed to write settings', error, { operation: 'runtime_context' });
    return false;
  }
}
