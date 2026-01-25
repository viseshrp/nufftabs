// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LIST_PAGE_PATH, STORAGE_KEYS } from '../../entrypoints/shared/storage';
import { createMockChrome } from '../helpers/mock_chrome';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('list page init', () => {
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
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

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
});
