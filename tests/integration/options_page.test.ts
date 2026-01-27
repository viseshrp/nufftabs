// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { initSettingsPage } from '../../entrypoints/options/settings_page';
import { STORAGE_KEYS } from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

describe('options settings page', () => {
  it('loads and saves settings', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: { excludePinned: true, restoreBatchSize: 25 },
      },
    });
    setMockChrome(mock.chrome);

    document.body.innerHTML = `
      <input id="excludePinned" type="checkbox" />
      <input id="restoreBatchSize" type="number" />
      <div id="status"></div>
    `;

    await initSettingsPage(document);

    const excludePinnedEl = document.querySelector<HTMLInputElement>('#excludePinned');
    const restoreBatchSizeEl = document.querySelector<HTMLInputElement>('#restoreBatchSize');
    if (!excludePinnedEl || !restoreBatchSizeEl) {
      throw new Error('Missing settings inputs');
    }

    expect(excludePinnedEl.checked).toBe(true);
    expect(restoreBatchSizeEl.value).toBe('25');

    excludePinnedEl.checked = false;
    excludePinnedEl.dispatchEvent(new Event('change'));

    restoreBatchSizeEl.value = '50';
    restoreBatchSizeEl.dispatchEvent(new Event('change'));

    const saved = mock.storageData[STORAGE_KEYS.settings] as {
      excludePinned?: boolean;
      restoreBatchSize?: number;
    };
    expect(saved.excludePinned).toBe(false);
    expect(saved.restoreBatchSize).toBe(50);
  });

  it('clears custom batch size when input is empty', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: { excludePinned: true, restoreBatchSize: 5 },
      },
    });
    setMockChrome(mock.chrome);

    document.body.innerHTML = `
      <input id="excludePinned" type="checkbox" />
      <input id="restoreBatchSize" type="number" />
      <div id="status"></div>
    `;

    await initSettingsPage(document);
    const restoreBatchSizeEl = document.querySelector<HTMLInputElement>('#restoreBatchSize');
    if (!restoreBatchSizeEl) {
      throw new Error('Missing restore batch size input');
    }
    restoreBatchSizeEl.value = '';
    restoreBatchSizeEl.dispatchEvent(new Event('blur'));

    const saved = mock.storageData[STORAGE_KEYS.settings] as {
      restoreBatchSize?: number;
    };
    expect(saved.restoreBatchSize).toBeUndefined();
  });

  it('handles invalid input and save failures', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.settings]: { excludePinned: true },
      },
    });
    setMockChrome(mock.chrome);
    mock.chrome.storage.local.set = async () => {
      throw new Error('fail');
    };

    document.body.innerHTML = `
      <input id="excludePinned" type="checkbox" />
      <input id="restoreBatchSize" type="number" />
      <div id="status"></div>
    `;

    await initSettingsPage(document);

    const restoreBatchSizeEl = document.querySelector<HTMLInputElement>('#restoreBatchSize');
    if (!restoreBatchSizeEl) {
      throw new Error('Missing restore batch size input');
    }
    restoreBatchSizeEl.value = '-1';
    restoreBatchSizeEl.dispatchEvent(new Event('change'));

    await new Promise((resolve) => setTimeout(resolve, 0));

    const status = document.querySelector<HTMLDivElement>('#status');
    expect(status?.textContent).toContain('Failed');
  });
});


