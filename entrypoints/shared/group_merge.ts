/**
 * Shared saved-group merge helpers used by import and restore flows.
 * Keeping this logic outside UI-specific modules lets multiple features reuse
 * the same duplicate-handling behavior without creating cross-layer imports.
 */
import { appendTabsByDuplicatePolicy, collectSavedTabUrls } from './duplicates';
import type { DuplicateTabsPolicy, SavedTabGroups } from './storage';

/** Shallow-copies a groups map so callers can replace arrays without mutating the original. */
export function cloneGroups(groups: SavedTabGroups): SavedTabGroups {
  // Shallow copy only; tab arrays are shared. Callers must replace arrays instead of mutating
  // them in place or the original state will be modified and change detection can be skipped.
  return { ...groups };
}

/**
 * Merges incoming groups into existing ones by group key.
 * When duplicate rejection is enabled, a single URL index is shared across the
 * whole restore/import so duplicate detection stays linear in total tab count.
 */
export function mergeGroups(
  existing: SavedTabGroups,
  incoming: SavedTabGroups,
  duplicateTabsPolicy: DuplicateTabsPolicy = 'allow',
): SavedTabGroups {
  const merged = cloneGroups(existing);
  const knownUrls = duplicateTabsPolicy === 'reject' ? collectSavedTabUrls(existing) : undefined;

  for (const [groupKey, tabs] of Object.entries(incoming)) {
    if (tabs.length === 0) continue;

    const existingTabs = merged[groupKey] ?? [];
    const { tabs: mergedTabs } = appendTabsByDuplicatePolicy(existingTabs, tabs, duplicateTabsPolicy, knownUrls);
    if (mergedTabs.length > 0) {
      merged[groupKey] = mergedTabs;
    }
  }

  return merged;
}
