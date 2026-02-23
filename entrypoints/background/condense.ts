/**
 * Orchestrates the condense workflow: query tabs, save eligible ones,
 * close them, and focus/create the list page tab.
 */
import {
  LIST_PAGE_PATH,
  appendSavedGroup,
  readSavedGroup,
  readSavedGroups,
  readSettings,
  type SavedTab,
} from '../shared/storage';
import { createCondenseGroupKey, filterEligibleTabs, resolveWindowId, saveTabsToList } from '../shared/condense';
import { collectSavedTabUrls } from '../shared/duplicates';
import { logExtensionError } from '../shared/utils';
import { focusExistingListTabOrCreate } from './list_tab';

/**
 * Verifies that a just-written group can be read back with the exact set of tab IDs and URLs.
 * This check is intentionally strict so we only close source tabs after persistence is confirmed.
 */
async function verifyCondenseWrite(groupKey: string, expectedTabs: SavedTab[]): Promise<boolean> {
  const persistedTabs = await readSavedGroup(groupKey);
  if (persistedTabs.length !== expectedTabs.length) return false;

  const expectedById = new Map(expectedTabs.map((tab) => [tab.id, tab]));
  for (const persistedTab of persistedTabs) {
    const expectedTab = expectedById.get(persistedTab.id);
    if (!expectedTab) return false;
    if (expectedTab.url !== persistedTab.url) return false;
    if (expectedTab.title !== persistedTab.title) return false;
  }
  return true;
}

/**
 * Main condense action: queries all tabs in the target (or current) window,
 * saves eligible ones to storage, closes them, and opens the list page.
 */
export async function condenseCurrentWindow(targetWindowId?: number): Promise<void> {
  const settings = await readSettings();
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query(
      typeof targetWindowId === 'number' ? { windowId: targetWindowId } : { currentWindow: true },
    );
  } catch (error) {
    logExtensionError('Failed to query tabs during condense', error, { operation: 'tab_query' });
    return;
  }

  const resolvedWindowId = resolveWindowId(tabs, targetWindowId);
  const listUrl = chrome.runtime.getURL(LIST_PAGE_PATH);
  let listTabs: chrome.tabs.Tab[] = [];
  try {
    listTabs = await chrome.tabs.query({ url: listUrl });
  } catch (error) {
    logExtensionError('Failed to query list tabs during condense', error, { operation: 'tab_query' });
    listTabs = [];
  }

  const eligibleTabs = filterEligibleTabs(tabs, listUrl, settings.excludePinned);

  if (eligibleTabs.length === 0) {
    await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
    return;
  }

  const now = Date.now();
  // Timestamp is captured once to keep group keys and savedAt values consistent.
  const groupKey = createCondenseGroupKey(resolvedWindowId, now);
  let tabsToSave = eligibleTabs;
  if (settings.duplicateTabsPolicy === 'reject') {
    const knownUrls = collectSavedTabUrls(await readSavedGroups());
    const uniqueTabs: chrome.tabs.Tab[] = [];
    for (const tab of eligibleTabs) {
      const candidateUrl = typeof tab.url === 'string' && tab.url.length > 0 ? tab.url : tab.pendingUrl;
      if (typeof candidateUrl !== 'string' || candidateUrl.length === 0) continue;
      if (knownUrls.has(candidateUrl)) continue;
      uniqueTabs.push(tab);
      knownUrls.add(candidateUrl);
    }
    tabsToSave = uniqueTabs;
  }
  const updatedGroup = saveTabsToList(tabsToSave, [], now);
  if (updatedGroup.length === 0) {
    await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
    return;
  }
  const saved = await appendSavedGroup(groupKey, updatedGroup);
  if (!saved) {
    await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
    return;
  }

  // Atomicity guard: never close source tabs until we can read back exactly what we wrote.
  const writeVerified = await verifyCondenseWrite(groupKey, updatedGroup);
  if (!writeVerified) {
    logExtensionError('Condense verification failed; source tabs were left open', new Error('condense_verification_failed'), {
      operation: 'runtime_context',
    });
    await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
    return;
  }

  if (tabs.length === eligibleTabs.length && listTabs.length === 0 && typeof resolvedWindowId === 'number') {
    try {
      const created = await chrome.tabs.create({
        url: listUrl,
        windowId: resolvedWindowId,
        active: false,
      });
      listTabs = created ? [created] : listTabs;
    } catch (error) {
      logExtensionError('Failed to create list tab during condense', error, { operation: 'tab_query' });
    }
  }

  // Remove condensed tabs after saving, but only when tab IDs are available.
  const tabIds = tabsToSave.map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
  if (tabIds.length > 0) {
    try {
      await chrome.tabs.remove(tabIds);
    } catch (error) {
      logExtensionError('Failed to remove tabs during condense', error, { operation: 'tab_query' });
    }
  }

  await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
}
