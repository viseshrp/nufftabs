import { condenseCurrentWindow } from './condense';

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
      void condenseCurrentWindow(windowId);
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  });
});
