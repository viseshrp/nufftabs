import { createSavedTab, type SavedTab, type SavedTabGroups } from '../shared/storage';

export function cloneGroups(groups: SavedTabGroups): SavedTabGroups {
  // Shallow copy only; tab arrays are shared. Callers must replace arrays instead of mutating
  // them in place or the original state will be modified and change detection can be skipped.
  return { ...groups };
}

export function countTotalTabs(groups: SavedTabGroups): number {
  return Object.values(groups).reduce((sum, tabs) => sum + tabs.length, 0);
}

export function isSameGroup(prev: SavedTab[] | undefined, next: SavedTab[]): boolean {
  // Heuristic: compare first/middle/last IDs to avoid O(n) checks. This can miss reorders
  // or edits that don't affect these pivot points, so the UI may skip a needed re-render.
  if (!prev) return false;
  if (prev.length !== next.length) return false;
  if (prev.length === 0) return true;
  const lastIndex = prev.length - 1;
  const midIndex = Math.floor(prev.length / 2);
  return (
    prev[0]?.id === next[0]?.id &&
    prev[lastIndex]?.id === next[lastIndex]?.id &&
    prev[midIndex]?.id === next[midIndex]?.id
  );
}

export function areGroupsEquivalent(prev: SavedTabGroups, next: SavedTabGroups): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of nextKeys) {
    if (!isSameGroup(prev[key], next[key] ?? [])) return false;
  }
  return true;
}

export function getGroupCreatedAt(tabs: SavedTab[]): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const tab of tabs) {
    const value = typeof tab.savedAt === 'number' ? tab.savedAt : Number.POSITIVE_INFINITY;
    if (value < earliest) earliest = value;
  }
  return Number.isFinite(earliest) ? earliest : Number.NEGATIVE_INFINITY;
}

export function formatCreatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function normalizeTabArray(data: unknown): SavedTab[] | null {
  if (!Array.isArray(data)) return null;

  const now = Date.now();
  const normalized: SavedTab[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') return null;
    const url = (entry as { url?: unknown }).url;
    if (typeof url !== 'string' || url.length === 0) return null;

    const id = (entry as { id?: unknown }).id;
    const title = (entry as { title?: unknown }).title;
    const savedAt = (entry as { savedAt?: unknown }).savedAt;

    normalized.push(
      createSavedTab({
        url,
        id: typeof id === 'string' && id.length > 0 ? id : undefined,
        title: typeof title === 'string' && title.length > 0 ? title : undefined,
        savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : now,
      }),
    );
  }

  return normalized;
}

export function normalizeImportedGroups(data: unknown, fallbackKey: string): SavedTabGroups | null {
  const payload = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as { savedTabs?: unknown }).savedTabs ?? data
      : null;

  if (!payload) return null;

  if (Array.isArray(payload)) {
    const normalized = normalizeTabArray(payload);
    if (!normalized) return null;
    return normalized.length > 0 ? { [fallbackKey]: normalized } : {};
  }

  if (payload && typeof payload === 'object') {
    const groups: SavedTabGroups = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const normalized = normalizeTabArray(value);
      if (!normalized) return null;
      if (normalized.length > 0) groups[key] = normalized;
    }
    return groups;
  }

  return null;
}

export function mergeGroups(existing: SavedTabGroups, incoming: SavedTabGroups): SavedTabGroups {
  const merged = cloneGroups(existing);
  for (const [groupKey, tabs] of Object.entries(incoming)) {
    if (tabs.length === 0) continue;
    const existingTabs = merged[groupKey];
    merged[groupKey] = existingTabs ? [...existingTabs, ...tabs] : tabs.slice();
  }
  return merged;
}
