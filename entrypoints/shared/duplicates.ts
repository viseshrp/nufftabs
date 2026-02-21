/**
 * Shared helpers for duplicate-tab handling.
 * Duplicate detection is URL-based because URL is the stable user-facing identity
 * used across condense/import flows and survives ID regeneration.
 */
import type { DuplicateTabsPolicy, SavedTab, SavedTabGroups } from './storage';

/** Builds a URL index from every saved tab across all groups. */
export function collectSavedTabUrls(groups: SavedTabGroups): Set<string> {
  const urls = new Set<string>();
  for (const tabs of Object.values(groups)) {
    for (const tab of tabs) {
      urls.add(tab.url);
    }
  }
  return urls;
}

/**
 * Appends tabs to `existingTabs` according to duplicate policy.
 * For `reject`, this function updates the provided `knownUrls` set in-place so
 * callers can keep a single global dedupe index across multiple groups.
 */
export function appendTabsByDuplicatePolicy(
  existingTabs: SavedTab[],
  incomingTabs: SavedTab[],
  duplicateTabsPolicy: DuplicateTabsPolicy,
  knownUrls: Set<string>,
): { tabs: SavedTab[]; addedCount: number } {
  if (incomingTabs.length === 0) {
    return { tabs: existingTabs, addedCount: 0 };
  }
  if (duplicateTabsPolicy === 'allow') {
    return { tabs: [...existingTabs, ...incomingTabs], addedCount: incomingTabs.length };
  }

  const appended: SavedTab[] = [];
  for (const tab of incomingTabs) {
    if (knownUrls.has(tab.url)) continue;
    appended.push(tab);
    knownUrls.add(tab.url);
  }
  if (appended.length === 0) {
    return { tabs: existingTabs, addedCount: 0 };
  }
  return { tabs: [...existingTabs, ...appended], addedCount: appended.length };
}
