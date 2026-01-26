import { describe, it, expect, vi } from 'vitest';
import { createMockChrome } from '../helpers/mock_chrome';

describe('background entrypoint', () => {
  it('registers action click listener without throwing', async () => {
    const mock = createMockChrome();
    const window = mock.createWindow(['https://example.com']);

    let clickHandler: ((tab?: chrome.tabs.Tab) => void) | undefined;

    // @ts-expect-error - test shim
    globalThis.chrome = {
      ...mock.chrome,
      action: {
        ...mock.chrome.action,
        onClicked: {
          addListener: (handler: typeof clickHandler) => {
            clickHandler = handler ?? undefined;
          },
        },
      },
    };
    // @ts-expect-error - test shim
    globalThis.defineBackground = (callback: () => void) => callback();

    vi.resetModules();
    await import('../../entrypoints/background/index');

    expect(clickHandler).toBeTypeOf('function');
    clickHandler?.({ windowId: window.id } as chrome.tabs.Tab);
  });
});
