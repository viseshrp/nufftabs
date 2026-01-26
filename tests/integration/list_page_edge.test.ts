// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMockChrome } from '../helpers/mock_chrome';

describe('list page edge cases', () => {
  it('handles missing DOM nodes without crashing', async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    await import('../../entrypoints/nufftabs/index');
    expect(true).toBe(true);
  });

  it('ignores unknown actions and empty targets', async () => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="groups"><button id="noop">noop</button></div>
      <div id="empty"></div>
      <div id="snackbar"></div>
    `;
    const mock = createMockChrome();
    // @ts-ignore - test shim
    globalThis.chrome = mock.chrome;

    await import('../../entrypoints/nufftabs/index');
    const groups = document.querySelector('#groups')!;
    const button = document.querySelector('#noop') as HTMLButtonElement;
    button.dataset.action = 'unknown';
    groups.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(true).toBe(true);
  });
});
