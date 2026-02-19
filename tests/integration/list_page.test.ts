// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIST_PAGE_PATH, STORAGE_KEYS } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('list page init', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders groups and handles restore single + clear', async () => {
    const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');
    document.documentElement.innerHTML = listHtml;

    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: ['1'],
        'savedTabs:1': [
          { id: 'a', url: 'https://example.com', title: 'Example', savedAt: 10 },
        ],
      },
    });
    setMockChrome(mock.chrome);

    const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
    const listWindow = mock.createWindow([listUrl]);
    mock.setCurrentTab(listWindow.tabs?.[0]?.id as number);

    await import('../../entrypoints/nufftabs/index');

    await new Promise((resolve) => setTimeout(resolve, 0));

    const tabCount = document.querySelector<HTMLSpanElement>('#tabCount');
    expect(tabCount?.textContent).toBe('1');

    const restoreButton = document.querySelector<HTMLButtonElement>('button[data-action="restore-single"]');
    expect(restoreButton).not.toBeNull();
    restoreButton?.click();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tabCount?.textContent).toBe('0');
    const empty = document.querySelector<HTMLDivElement>('#empty');
    expect(empty?.style.display).toBe('block');

    const jsonArea = document.querySelector<HTMLTextAreaElement>('#jsonArea');
    if (jsonArea) jsonArea.value = 'test';
    const clearButton = document.querySelector<HTMLButtonElement>('#clearJson');
    clearButton?.click();

    const snackbar = document.querySelector<HTMLDivElement>('#snackbar');
    expect(snackbar?.textContent).toContain('Cleared');
  });

  it('filters groups dynamically and keeps row actions working', async () => {
    const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');
    document.documentElement.innerHTML = listHtml;

    const firstGroup = '1-1000-a';
    const secondGroup = '2-2000-b';
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: [firstGroup, secondGroup],
        [`savedTabs:${firstGroup}`]: [
          { id: 'a', url: 'https://alpha.dev/docs', title: 'Alpha Docs', savedAt: 10 },
        ],
        [`savedTabs:${secondGroup}`]: [
          { id: 'b', url: 'https://beta.dev/blog', title: 'Beta Blog', savedAt: 20 },
        ],
      },
    });
    setMockChrome(mock.chrome);

    await import('../../entrypoints/nufftabs/index');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll('.group-card')).toHaveLength(2);

    const searchInput = document.querySelector<HTMLInputElement>('#searchTabs');
    if (!searchInput) throw new Error('Missing search input');

    searchInput.value = 'alpha';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll('.group-card')).toHaveLength(1);
    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(1);

    const deleteButton = document.querySelector<HTMLButtonElement>('button[data-action="delete-single"]');
    if (!deleteButton) throw new Error('Missing delete button');
    deleteButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tabCount = document.querySelector<HTMLSpanElement>('#tabCount');
    expect(tabCount?.textContent).toBe('1');
    expect(document.querySelectorAll('.group-card')).toHaveLength(0);
    expect(document.querySelector('#empty')?.textContent).toContain('No matching tabs');

    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll('.group-card')).toHaveLength(1);
  });

  it('lazy-loads group rows while header count stays total', async () => {
    const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');
    document.documentElement.innerHTML = listHtml;

    const firstGroup = '1-3000-a';
    const secondGroup = '1-2000-b';
    const thirdGroup = '1-1000-c';
    const rectByGroup: Record<string, { top: number; bottom: number }> = {
      [firstGroup]: { top: 100, bottom: 200 },
      [secondGroup]: { top: 4000, bottom: 4100 },
      [thirdGroup]: { top: 5000, bottom: 5100 },
    };

    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const byGroup = this.dataset?.groupKey ? rectByGroup[this.dataset.groupKey] : undefined;
      const top = byGroup?.top ?? 0;
      const bottom = byGroup?.bottom ?? 100;
      return {
        x: 0,
        y: top,
        width: 100,
        height: Math.max(0, bottom - top),
        top,
        bottom,
        left: 0,
        right: 100,
        toJSON: () => ({}),
      } as DOMRect;
    });
    window.requestAnimationFrame = vi.fn(() => 0);

    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: [firstGroup, secondGroup, thirdGroup],
        [`savedTabs:${firstGroup}`]: [{ id: 'a', url: 'https://a.com', title: 'A', savedAt: 10 }],
        [`savedTabs:${secondGroup}`]: [{ id: 'b', url: 'https://b.com', title: 'B', savedAt: 20 }],
        [`savedTabs:${thirdGroup}`]: [{ id: 'c', url: 'https://c.com', title: 'C', savedAt: 30 }],
      },
    });
    setMockChrome(mock.chrome);

    await import('../../entrypoints/nufftabs/index');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tabCount = document.querySelector<HTMLSpanElement>('#tabCount');
    expect(tabCount?.textContent).toBe('3');
    expect(document.querySelectorAll('.group-card')).toHaveLength(3);
    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(1);

    // Bring the second card into viewport and allow one RAF tick to load it.
    rectByGroup[secondGroup] = { top: 120, bottom: 220 };
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(1);
      return 1;
    };
    window.dispatchEvent(new Event('scroll'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(2);
    expect(tabCount?.textContent).toBe('3');
  });

  it('search finds matches from initially-unloaded groups', async () => {
    const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');
    document.documentElement.innerHTML = listHtml;

    const nearGroup = '1-3000-near';
    const farGroup = '1-2000-far';
    const rectByGroup: Record<string, { top: number; bottom: number }> = {
      [nearGroup]: { top: 100, bottom: 200 },
      [farGroup]: { top: 5000, bottom: 5100 },
    };

    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const byGroup = this.dataset?.groupKey ? rectByGroup[this.dataset.groupKey] : undefined;
      const top = byGroup?.top ?? 0;
      const bottom = byGroup?.bottom ?? 100;
      return {
        x: 0,
        y: top,
        width: 100,
        height: Math.max(0, bottom - top),
        top,
        bottom,
        left: 0,
        right: 100,
        toJSON: () => ({}),
      } as DOMRect;
    });
    window.requestAnimationFrame = vi.fn(() => 0);

    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: [nearGroup, farGroup],
        [`savedTabs:${nearGroup}`]: [
          { id: 'near', url: 'https://near.com', title: 'Near Item', savedAt: 10 },
        ],
        [`savedTabs:${farGroup}`]: [
          { id: 'far', url: 'https://far.com/deep-search', title: 'Far Match', savedAt: 20 },
        ],
      },
    });
    setMockChrome(mock.chrome);

    await import('../../entrypoints/nufftabs/index');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const searchInput = document.querySelector<HTMLInputElement>('#searchTabs');
    const tabCount = document.querySelector<HTMLSpanElement>('#tabCount');
    if (!searchInput) throw new Error('Missing search input');

    // Only near group rows are loaded before searching.
    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(1);
    expect(tabCount?.textContent).toBe('2');

    searchInput.value = 'deep-search';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const visibleCards = document.querySelectorAll<HTMLElement>('.group-card');
    expect(visibleCards).toHaveLength(1);
    expect(visibleCards[0]?.dataset.groupKey).toBe(farGroup);
    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(1);
    expect(tabCount?.textContent).toBe('2');
  });

  it('keeps filtered pagination and group header counts consistent', async () => {
    const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');
    document.documentElement.innerHTML = listHtml;

    const groupKey = '1-5000-big';
    const matchingTabs = Array.from({ length: 205 }, (_, index) => ({
      id: `match-${index}`,
      url: `https://alpha.example/${index}`,
      title: `Alpha ${index}`,
      savedAt: 10 + index,
    }));
    const nonMatchingTabs = Array.from({ length: 25 }, (_, index) => ({
      id: `other-${index}`,
      url: `https://other.example/${index}`,
      title: `Other ${index}`,
      savedAt: 1000 + index,
    }));
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: [groupKey],
        [`savedTabs:${groupKey}`]: [...matchingTabs, ...nonMatchingTabs],
      },
    });
    setMockChrome(mock.chrome);

    await import('../../entrypoints/nufftabs/index');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const appBar = document.querySelector<HTMLElement>('.app-bar');
    const searchInput = document.querySelector<HTMLInputElement>('#searchTabs');
    if (!searchInput) throw new Error('Missing search input');
    expect(searchInput.type).toBe('search');
    expect(appBar?.contains(searchInput)).toBe(true);

    searchInput.value = 'alpha';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const groupTitle = document.querySelector<HTMLElement>('.group-title');
    expect(groupTitle?.textContent).toBe('205 of 230 tabs');
    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(200);

    const loadMore = document.querySelector<HTMLButtonElement>('button[data-action="load-more"]');
    expect(loadMore?.textContent).toContain('5 remaining');
    loadMore?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(205);
    expect(document.querySelector('button[data-action="load-more"]')).toBeNull();
  });

  it('preserves row actions for search results loaded on demand', async () => {
    const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');
    document.documentElement.innerHTML = listHtml;

    const nearGroup = '1-3000-near';
    const farGroup = '1-2000-far';
    const rectByGroup: Record<string, { top: number; bottom: number }> = {
      [nearGroup]: { top: 100, bottom: 200 },
      [farGroup]: { top: 5000, bottom: 5100 },
    };

    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const byGroup = this.dataset?.groupKey ? rectByGroup[this.dataset.groupKey] : undefined;
      const top = byGroup?.top ?? 0;
      const bottom = byGroup?.bottom ?? 100;
      return {
        x: 0,
        y: top,
        width: 100,
        height: Math.max(0, bottom - top),
        top,
        bottom,
        left: 0,
        right: 100,
        toJSON: () => ({}),
      } as DOMRect;
    });
    window.requestAnimationFrame = vi.fn(() => 0);

    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: [nearGroup, farGroup],
        [`savedTabs:${nearGroup}`]: [{ id: 'near', url: 'https://near.com', title: 'Near Item', savedAt: 10 }],
        [`savedTabs:${farGroup}`]: [{ id: 'far', url: 'https://far.com/deep-match', title: 'Far Match', savedAt: 20 }],
      },
    });
    setMockChrome(mock.chrome);

    await import('../../entrypoints/nufftabs/index');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tabCount = document.querySelector<HTMLSpanElement>('#tabCount');
    const searchInput = document.querySelector<HTMLInputElement>('#searchTabs');
    if (!searchInput) throw new Error('Missing search input');

    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(1);
    expect(tabCount?.textContent).toBe('2');

    searchInput.value = 'deep-match';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const deleteButton = document.querySelector<HTMLButtonElement>('button[data-action="delete-single"]');
    expect(deleteButton).not.toBeNull();
    deleteButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tabCount?.textContent).toBe('1');
    expect(document.querySelectorAll('.group-card')).toHaveLength(0);
    expect(document.querySelector('#empty')?.textContent).toContain('No matching tabs');

    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelectorAll('.group-card')).toHaveLength(1);
    expect(document.querySelectorAll('.item[data-tab-id]')).toHaveLength(1);
  });

  it('collapses all groups except the most recent on initial load', async () => {
    // Set up three groups with distinct timestamps so sort order is deterministic.
    const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');
    document.documentElement.innerHTML = listHtml;

    const oldest = '1-1000-oldest';
    const middle = '1-2000-middle';
    const newest = '1-3000-newest';

    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: [oldest, middle, newest],
        [`savedTabs:${oldest}`]: [{ id: 'a', url: 'https://a.com', title: 'A', savedAt: 10 }],
        [`savedTabs:${middle}`]: [{ id: 'b', url: 'https://b.com', title: 'B', savedAt: 20 }],
        [`savedTabs:${newest}`]: [{ id: 'c', url: 'https://c.com', title: 'C', savedAt: 30 }],
      },
    });
    setMockChrome(mock.chrome);

    await import('../../entrypoints/nufftabs/index');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Three group cards should render.
    const cards = document.querySelectorAll<HTMLElement>('.group-card');
    expect(cards).toHaveLength(3);

    // The most recent group (newest, sorted first) should NOT be collapsed.
    const newestCard = document.querySelector<HTMLElement>(`[data-group-key="${newest}"]`);
    expect(newestCard?.classList.contains('is-collapsed')).toBe(false);

    // The other two groups should be collapsed.
    const middleCard = document.querySelector<HTMLElement>(`[data-group-key="${middle}"]`);
    expect(middleCard?.classList.contains('is-collapsed')).toBe(true);

    const oldestCard = document.querySelector<HTMLElement>(`[data-group-key="${oldest}"]`);
    expect(oldestCard?.classList.contains('is-collapsed')).toBe(true);
  });

  it('toggleCollapseAll button expands and collapses all groups', async () => {
    // Set up two groups so the default collapse applies (only newest expanded).
    const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');
    document.documentElement.innerHTML = listHtml;

    const older = '1-1000-older';
    const newer = '1-2000-newer';

    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: [older, newer],
        [`savedTabs:${older}`]: [{ id: 'x', url: 'https://x.com', title: 'X', savedAt: 10 }],
        [`savedTabs:${newer}`]: [{ id: 'y', url: 'https://y.com', title: 'Y', savedAt: 20 }],
      },
    });
    setMockChrome(mock.chrome);

    await import('../../entrypoints/nufftabs/index');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const toggleBtn = document.querySelector<HTMLButtonElement>('#toggleCollapseAll');
    expect(toggleBtn).not.toBeNull();

    // After initial load the older group should be collapsed and the newer one open.
    const olderCard = document.querySelector<HTMLElement>(`[data-group-key="${older}"]`);
    const newerCard = document.querySelector<HTMLElement>(`[data-group-key="${newer}"]`);
    expect(olderCard?.classList.contains('is-collapsed')).toBe(true);
    expect(newerCard?.classList.contains('is-collapsed')).toBe(false);

    // Click: should collapse all groups (the newer one was still open).
    toggleBtn?.click();
    expect(olderCard?.classList.contains('is-collapsed')).toBe(true);
    expect(newerCard?.classList.contains('is-collapsed')).toBe(true);
    expect(toggleBtn?.getAttribute('aria-label')).toBe('Expand all groups');

    // Click again: should expand all groups.
    toggleBtn?.click();
    expect(olderCard?.classList.contains('is-collapsed')).toBe(false);
    expect(newerCard?.classList.contains('is-collapsed')).toBe(false);
    expect(toggleBtn?.getAttribute('aria-label')).toBe('Collapse all groups');
  });
});
