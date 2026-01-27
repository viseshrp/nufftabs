import { describe, it, expect, vi } from 'vitest';
import { createMockChrome, setMockChrome, setMockDefineBackground } from '../helpers/mock_chrome';

describe('background entrypoint', () => {
  it('registers action click listener without throwing', async () => {
    const mock = createMockChrome();
    const window = mock.createWindow(['https://example.com']);

    let clickHandler: ((tab?: chrome.tabs.Tab) => void) | undefined;

    setMockChrome({
      ...mock.chrome,
      action: {
        ...mock.chrome.action,
        onClicked: {
          addListener: (handler?: unknown) => {
            clickHandler = handler as ((tab?: chrome.tabs.Tab) => void) | undefined;
          },
        },
      },
    });
    setMockDefineBackground((callback: () => void) => callback());

    vi.resetModules();
    await import('../../entrypoints/background/index');

    expect(clickHandler).toBeTypeOf('function');
    clickHandler?.({ windowId: window.id } as chrome.tabs.Tab);
  });
});

