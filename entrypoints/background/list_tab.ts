export function pickMostRecentListTab(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined {
  return tabs.reduce<chrome.tabs.Tab | undefined>((best, tab) => {
    if (!best) return tab;
    const bestAccessed = typeof best.lastAccessed === 'number' ? best.lastAccessed : 0;
    const tabAccessed = typeof tab.lastAccessed === 'number' ? tab.lastAccessed : 0;
    if (tabAccessed > bestAccessed) return tab;
    if (tabAccessed === bestAccessed && tab.active && !best.active) return tab;
    return best;
  }, undefined);
}

export async function focusExistingListTabOrCreate(
  listTabs: chrome.tabs.Tab[],
  listUrl: string,
  preferredWindowId?: number,
): Promise<void> {
  const existing = pickMostRecentListTab(listTabs);
  if (existing && typeof existing.id === 'number') {
    try {
      await chrome.tabs.update(existing.id, { active: true, pinned: true });
      if (typeof existing.windowId === 'number') {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    } catch (error) {
      void error;
    }
  }

  try {
    const created = await chrome.tabs.create(
      typeof preferredWindowId === 'number'
        ? { url: listUrl, windowId: preferredWindowId, active: true }
        : { url: listUrl, active: true },
    );
    if (typeof created.id === 'number') {
      await chrome.tabs.update(created.id, { pinned: true });
    }
    if (typeof created.windowId === 'number') {
      await chrome.windows.update(created.windowId, { focused: true });
    }
  } catch (error) {
    void error;
  }
}
