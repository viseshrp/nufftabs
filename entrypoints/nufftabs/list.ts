/**
 * Pure utility functions for the list page: cloning, comparing, counting,
 * formatting, normalizing, and merging saved tab groups.
 */
import {
  createSavedTab,
  filterSavedGroupMetadataForKeys,
  normalizeSavedGroupMetadata,
  type SavedTab,
  type SavedTabGroupMetadata,
  type SavedTabGroups,
} from '../shared/storage';
import { cloneGroups, mergeGroupMetadata, mergeGroups } from '../shared/group_merge';

export { cloneGroups, mergeGroupMetadata, mergeGroups };

/** Returns the total number of individual tabs across all groups. */
export function countTotalTabs(groups: SavedTabGroups): number {
  return Object.values(groups).reduce((sum, tabs) => sum + tabs.length, 0);
}

/**
 * Heuristic equality check for two tab arrays by comparing first, middle,
 * and last IDs. Avoids O(n) full comparison but may miss internal reorders.
 */
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

/** Deep equality check across all group keys using `isSameGroup` per entry. */
export function areGroupsEquivalent(prev: SavedTabGroups, next: SavedTabGroups): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of nextKeys) {
    if (!isSameGroup(prev[key], next[key] ?? [])) return false;
  }
  return true;
}

/** Returns the earliest `savedAt` timestamp in a tab array (used as the group creation time). */
export function getGroupCreatedAt(tabs: SavedTab[]): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const tab of tabs) {
    const value = typeof tab.savedAt === 'number' ? tab.savedAt : Number.POSITIVE_INFINITY;
    if (value < earliest) earliest = value;
  }
  return Number.isFinite(earliest) ? earliest : Number.NEGATIVE_INFINITY;
}

/** Formats an epoch-ms timestamp into a locale-aware date/time string. */
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

/** Validates and normalizes an unknown array into `SavedTab[]`, returning null if the shape is invalid. */
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

/** Normalized import payload used by JSON import, file import, and Drive restore logic. */
export type NormalizedImportedPayload = {
  /** Valid tab groups parsed from the incoming JSON shape. */
  groups: SavedTabGroups;
  /** Pinned group flags parsed from the incoming JSON shape and scoped to `groups`. */
  groupMetadata: SavedTabGroupMetadata;
};

/** Extracts the tab-group portion from supported import wrappers. */
function getImportedGroupsPayload(data: unknown): unknown | null {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const objectData = data as Record<string, unknown>;
  return Object.hasOwn(objectData, 'savedTabs') ? objectData.savedTabs : data;
}

/** Extracts optional group metadata from supported import wrappers. */
function getImportedGroupMetadataPayload(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;

  const objectData = data as Record<string, unknown>;
  return objectData.groupMetadata ?? objectData.savedTabGroupMetadata;
}

/**
 * Normalizes unknown imported data into tab groups plus optional group metadata.
 * Handles flat arrays, `{ savedTabs: ... }` wrappers, and direct group objects.
 */
export function normalizeImportedPayload(data: unknown, fallbackKey: string): NormalizedImportedPayload | null {
  const payload = getImportedGroupsPayload(data);

  if (!payload) return null;

  let groups: SavedTabGroups | null = null;
  if (Array.isArray(payload)) {
    const normalized = normalizeTabArray(payload);
    if (!normalized) return null;
    groups = normalized.length > 0 ? { [fallbackKey]: normalized } : {};
  } else if (payload && typeof payload === 'object') {
    groups = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const normalized = normalizeTabArray(value);
      if (!normalized) return null;
      if (normalized.length > 0) groups[key] = normalized;
    }
  }

  if (!groups) return null;

  const groupMetadata = filterSavedGroupMetadataForKeys(
    normalizeSavedGroupMetadata(getImportedGroupMetadataPayload(data)),
    Object.keys(groups),
  );
  return { groups, groupMetadata };
}

/** Backwards-compatible helper for callers/tests that only need imported groups. */
export function normalizeImportedGroups(data: unknown, fallbackKey: string): SavedTabGroups | null {
  return normalizeImportedPayload(data, fallbackKey)?.groups ?? null;
}
