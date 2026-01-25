import { LIST_PAGE_PATH, readSavedGroup, readSettings, UNKNOWN_GROUP_KEY, writeSavedGroup } from '../shared/storage';
import { filterEligibleTabs, resolveWindowId, saveTabsToList } from '../shared/condense';
import { focusExistingListTabOrCreate } from './list_tab';

export async function condenseCurrentWindow(targetWindowId?: number): Promise<void> {
  const settings = await readSettings();
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query(
      typeof targetWindowId === 'number' ? { windowId: targetWindowId } : { currentWindow: true },
    );
  } catch {
    return;
  }

  const resolvedWindowId = resolveWindowId(tabs, targetWindowId);
  const listUrl = chrome.runtime.getURL(LIST_PAGE_PATH);
  let listTabs: chrome.tabs.Tab[] = [];
  try {
    listTabs = await chrome.tabs.query({ url: listUrl });
  } catch {
    listTabs = [];
  }

  const eligibleTabs = filterEligibleTabs(tabs, listUrl, settings.excludePinned);

  if (eligibleTabs.length === 0) {
    await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
    return;
  }

  const groupKey = typeof resolvedWindowId === 'number' ? String(resolvedWindowId) : UNKNOWN_GROUP_KEY;
  const [existingGroup, tabIds] = await Promise.all([
    readSavedGroup(groupKey),
    Promise.resolve(eligibleTabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number')),
  ]);

  const updatedGroup = saveTabsToList(eligibleTabs, existingGroup);
  const saved = await writeSavedGroup(groupKey, updatedGroup);
  if (!saved) {
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
      void error;
    }
  }

  if (tabIds.length > 0) {
    try {
      await chrome.tabs.remove(tabIds);
    } catch (error) {
      void error;
    }
  }

  await focusExistingListTabOrCreate(listTabs, listUrl, resolvedWindowId);
}
