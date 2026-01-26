// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createMockChrome } from '../helpers/mock_chrome';

describe('options entrypoint', () => {
  it('initializes the settings page module', async () => {
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    document.body.innerHTML = `
      <input id="excludePinned" type="checkbox" />
      <input id="restoreBatchSize" type="number" />
      <div id="status"></div>
    `;

    await import('../../entrypoints/options/index');
    expect(document.querySelector('#excludePinned')).not.toBeNull();
  });
});
