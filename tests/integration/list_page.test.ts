// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIST_PAGE_PATH, STORAGE_KEYS } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('list page init', () => {
  beforeEach(() => {
    vi.resetModules();
    document.documentElement.innerHTML = '';
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
});
