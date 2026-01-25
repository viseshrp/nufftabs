import { describe, it, expect, vi } from 'vitest';
import { createMockChrome } from '../helpers/mock_chrome';

describe('background entrypoint', () => {
  it('registers listeners without throwing', async () => {
    const mock = createMockChrome();
    const window = mock.createWindow(['https://example.com']);

    let messageHandler: ((message: unknown, sender: chrome.runtime.MessageSender, sendResponse: () => void) => void) | undefined;

    // @ts-expect-error - test shim
    globalThis.chrome = {
      ...mock.chrome,
      runtime: {
        ...mock.chrome.runtime,
        onMessage: {
          addListener: (handler: typeof messageHandler) => {
            messageHandler = handler ?? undefined;
          },
        },
      },
    };
    // @ts-expect-error - test shim
    globalThis.defineBackground = (callback: () => void) => callback();

    vi.resetModules();
    await import('../../entrypoints/background/index');

    expect(messageHandler).toBeTypeOf('function');

    await new Promise<void>((resolve) => {
      messageHandler?.({ type: 'condense', windowId: window.id }, { tab: { windowId: window.id } }, () => {
        resolve();
      });
    });

    messageHandler?.({ type: 'noop' }, { tab: { windowId: window.id } }, () => undefined);
    messageHandler?.(null, { tab: { windowId: window.id } }, () => undefined);
    await new Promise<void>((resolve) => {
      messageHandler?.({ type: 'condense' }, { tab: { windowId: window.id } }, () => {
        resolve();
      });
    });
  });
});
