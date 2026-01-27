import { condenseCurrentWindow } from '../../../../entrypoints/background/condense';

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId);
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && typeof message === 'object' && (message as { type?: unknown }).type === 'condense') {
      const windowId =
        typeof (message as { windowId?: unknown }).windowId === 'number'
          ? (message as { windowId?: number }).windowId
          : sender?.tab?.windowId;
      // Ensure the response resolves only after condense finishes to reduce test flake.
      void condenseCurrentWindow(windowId)
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    return undefined;
  });
});
