import { describe, expect, it } from 'vitest';
import { filterEligibleTabs, resolveWindowId, saveTabsToList } from '../../entrypoints/shared/condense_logic';

describe('condense_logic', () => {
  it('filters pinned and list tab URLs', () => {
    const listUrl = 'chrome-extension://mock/nufftabs.html';
    const tabs = [
      { id: 1, url: 'https://example.com', pinned: false },
      { id: 2, url: 'https://example.com/2', pinned: true },
      { id: 3, url: listUrl, pinned: false },
      { id: 4, url: '', pinned: false },
    ] as chrome.tabs.Tab[];

    const eligible = filterEligibleTabs(tabs, listUrl, true);
    expect(eligible.map((tab) => tab.id)).toEqual([1]);

    const eligibleAll = filterEligibleTabs(tabs, listUrl, false);
    expect(eligibleAll.map((tab) => tab.id)).toEqual([1, 2]);
  });

  it('resolves window id from target or tabs', () => {
    const tabs = [{ windowId: 4 }, { windowId: 9 }] as chrome.tabs.Tab[];
    expect(resolveWindowId(tabs, 3)).toBe(3);
    expect(resolveWindowId(tabs)).toBe(4);
    expect(resolveWindowId([])).toBeUndefined();
  });

  it('saves tabs with consistent timestamps and prepends existing', () => {
    const now = 1700000000000;
    const tabs = [
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com' },
    ] as chrome.tabs.Tab[];
    const existing = [
      { id: 'old', url: 'https://c.com', title: 'C', savedAt: now - 1 },
    ];

    const saved = saveTabsToList(tabs, existing, now);
    expect(saved).toHaveLength(3);
    expect(saved[0]?.url).toBe('https://a.com');
    expect(saved[1]?.title).toBe('https://b.com');
    expect(saved[0]?.savedAt).toBe(now);
    expect(saved[2]?.id).toBe('old');
  });
});
