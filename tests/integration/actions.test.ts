// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIST_PAGE_PATH, STORAGE_KEYS } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

const listHtml = readFileSync(join(process.cwd(), 'entrypoints', 'nufftabs', 'index.html'), 'utf-8');

async function setupListPage(groups: Record<string, unknown[]>) {
  vi.resetModules();
  document.documentElement.innerHTML = listHtml;

  const savedTabsIndex = Object.keys(groups);
  const storagePayload: Record<string, unknown> = { [STORAGE_KEYS.savedTabsIndex]: savedTabsIndex };
  for (const [key, tabs] of Object.entries(groups)) {
    storagePayload[`savedTabs:${key}`] = tabs;
  }

  const mock = createMockChrome({ initialStorage: storagePayload });
  setMockChrome(mock.chrome);

  const listUrl = mock.chrome.runtime.getURL(LIST_PAGE_PATH);
  const listWindow = mock.createWindow([listUrl]);
  mock.setCurrentTab(listWindow.tabs?.[0]?.id as number);

  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
  globalThis.URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();

  await import('../../entrypoints/nufftabs/index');
  await new Promise((resolve) => setTimeout(resolve, 0));

  return { mock, listUrl };
}

describe('list page actions', () => {
  it('supports collapse, load more, delete single, delete group', async () => {
    const bigGroup = Array.from({ length: 210 }, (_, index) => ({
      id: `tab-${index}`,
      url: `https://example.com/${index}`,
      title: `Tab ${index}`,
      savedAt: 10 + index,
    }));

    await setupListPage({ '1': bigGroup, '2': [{ id: 'x', url: 'https://x.com', title: 'X', savedAt: 1 }] });

    const collapse = document.querySelector<HTMLButtonElement>('button[data-action="toggle-collapse"]');
    collapse?.click();
    const card = document.querySelector<HTMLElement>('.group-card');
    expect(card?.classList.contains('is-collapsed')).toBe(true);

    const loadMore = document.querySelector<HTMLButtonElement>('button[data-action="load-more"]');
    loadMore?.click();
    const items = document.querySelectorAll('li.item');
    expect(items.length).toBeGreaterThan(200);

    const deleteSingle = document.querySelector<HTMLButtonElement>('button[data-action="delete-single"]');
    deleteSingle?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = document.querySelector<HTMLDivElement>('#snackbar');
    expect(status?.textContent).toContain('Deleted 1 tab.');

    const deleteGroup = document.querySelector<HTMLButtonElement>('button[data-action="delete-group"]');
    deleteGroup?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cards = document.querySelectorAll('.group-card');
    expect(cards.length).toBe(1);
  });

  it('supports export/import JSON and OneTab import', async () => {
    await setupListPage({
      '1': [{ id: 'a', url: 'https://example.com', title: 'Example', savedAt: 1 }],
    });

    const toggleIo = document.querySelector<HTMLButtonElement>('#toggleIo');
    toggleIo?.click();

    const exportJson = document.querySelector<HTMLButtonElement>('#exportJson');
    exportJson?.click();
    const jsonArea = document.querySelector<HTMLTextAreaElement>('#jsonArea');
    expect(jsonArea?.value).toContain('savedTabs');

    if (jsonArea) {
      jsonArea.value = JSON.stringify([{ url: 'https://imported.com' }]);
    }
    const importJson = document.querySelector<HTMLButtonElement>('button#importJson');
    importJson?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const importJsonReplace = document.querySelector<HTMLButtonElement>('button#importJsonReplace');
    importJsonReplace?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (jsonArea) {
      jsonArea.value = 'https://valid.com | Valid\ninvalid';
    }
    const importOneTab = document.querySelector<HTMLButtonElement>('button#importOneTab');
    importOneTab?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = document.querySelector<HTMLDivElement>('#snackbar');
    expect(status?.textContent).toContain('skipped');
  });

  it('silently rejects duplicates during JSON and OneTab imports when configured', async () => {
    const { mock } = await setupListPage({
      '1': [{ id: 'a', url: 'https://existing.com', title: 'Existing', savedAt: 1 }],
    });
    mock.storageData[STORAGE_KEYS.settings] = { excludePinned: true, duplicateTabsPolicy: 'reject' };

    const toggleIo = document.querySelector<HTMLButtonElement>('#toggleIo');
    toggleIo?.click();

    const jsonArea = document.querySelector<HTMLTextAreaElement>('#jsonArea');
    if (jsonArea) {
      jsonArea.value = JSON.stringify([{ url: 'https://existing.com' }, { url: 'https://new-json.com' }]);
    }
    const importJson = document.querySelector<HTMLButtonElement>('button#importJson');
    importJson?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (jsonArea) {
      jsonArea.value = 'https://existing.com | Existing Duplicate\nhttps://new-onetab.com | New OneTab';
    }
    const importOneTab = document.querySelector<HTMLButtonElement>('button#importOneTab');
    importOneTab?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const savedIndex = mock.storageData[STORAGE_KEYS.savedTabsIndex];
    if (!Array.isArray(savedIndex)) {
      throw new Error('Missing saved tabs index');
    }
    const urls = savedIndex.flatMap((groupKey) => {
      const group = mock.storageData[`savedTabs:${groupKey}`];
      if (!Array.isArray(group)) return [];
      return group.map((tab) => (tab && typeof tab === 'object' ? (tab as { url?: unknown }).url : undefined));
    });
    const existingUrls = urls.filter((url): url is string => typeof url === 'string' && url === 'https://existing.com');
    expect(existingUrls).toHaveLength(1);
    expect(urls).toContain('https://new-json.com');
    expect(urls).toContain('https://new-onetab.com');
  });

  it('shows error on invalid JSON import', async () => {
    await setupListPage({});

    const toggleIo = document.querySelector<HTMLButtonElement>('#toggleIo');
    toggleIo?.click();

    const jsonArea = document.querySelector<HTMLTextAreaElement>('#jsonArea');
    if (jsonArea) jsonArea.value = '{bad json';
    const importJson = document.querySelector<HTMLButtonElement>('button#importJson');
    importJson?.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = document.querySelector<HTMLDivElement>('#snackbar');
    expect(status?.textContent).toContain('Invalid JSON');
  });

  it('covers restore-group, import file, and no-op OneTab', async () => {
    await setupListPage({
      '1': [{ id: 'a', url: 'https://example.com', title: 'Example', savedAt: 1 }],
    });

    const toggleIo = document.querySelector<HTMLButtonElement>('#toggleIo');
    toggleIo?.click();

    const jsonArea = document.querySelector<HTMLTextAreaElement>('#jsonArea');
    if (jsonArea) {
      jsonArea.value = JSON.stringify({ savedTabs: 'bad' });
    }
    const importJson = document.querySelector<HTMLButtonElement>('button#importJson');
    importJson?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fileInput = document.querySelector<HTMLInputElement>('#importFileInput');
    const fileButton = document.querySelector<HTMLButtonElement>('#importFile');
    const payload = new File([JSON.stringify([{ url: 'https://file.com' }])], 'tabs.json', {
      type: 'application/json',
    });
    if (fileInput) {
      Object.defineProperty(fileInput, 'files', { value: [payload] });
    }
    fileButton?.click();
    fileInput?.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (jsonArea) {
      jsonArea.value = 'not-a-url';
    }
    const importOneTab = document.querySelector<HTMLButtonElement>('button#importOneTab');
    importOneTab?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = document.querySelector<HTMLDivElement>('#snackbar');
    expect(status?.textContent).toContain('No valid OneTab links found to import.');

    const restoreGroup = document.querySelector<HTMLButtonElement>('button[data-action="restore-group"]');
    restoreGroup?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(status?.textContent).toContain('Restored all');
    const remainingGroups = document.querySelectorAll('.group-card');
    expect(remainingGroups.length).toBe(0);
  });

  it('updates scroll controls and handles missing tab ids', async () => {
    await setupListPage({
      '1': [{ id: 'a', url: 'https://example.com', title: 'Example', savedAt: 1 }],
    });

    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 100, configurable: true });
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(1);
      return 1;
    };

    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));

    const restoreButton = document.querySelector<HTMLButtonElement>('button[data-action="restore-single"]');
    if (restoreButton) restoreButton.dataset.tabId = 'missing';
    restoreButton?.click();

    const deleteButton = document.querySelector<HTMLButtonElement>('button[data-action="delete-single"]');
    if (deleteButton) deleteButton.dataset.tabId = 'missing';
    deleteButton?.click();

    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = document.querySelector<HTMLDivElement>('#snackbar');
    expect(status?.textContent).toContain('Tab not found');
  });

  it('handles file import read errors', async () => {
    await setupListPage({});

    const toggleIo = document.querySelector<HTMLButtonElement>('#toggleIo');
    toggleIo?.click();

    const fileInput = document.querySelector<HTMLInputElement>('#importFileInput');
    const fileButton = document.querySelector<HTMLButtonElement>('#importFile');
    const badFile = new File(['bad'], 'bad.json', { type: 'application/json' });
    Object.defineProperty(badFile, 'text', {
      value: async () => {
        throw new Error('bad');
      },
    });
    if (fileInput) {
      Object.defineProperty(fileInput, 'files', { value: [badFile] });
    }
    fileButton?.click();
    fileInput?.dispatchEvent(new Event('change'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    const status = document.querySelector<HTMLDivElement>('#snackbar');
    expect(status?.textContent).toContain('Import failed: Could not read the selected file.');
  });
});
