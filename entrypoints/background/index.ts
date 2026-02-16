import { condenseCurrentWindow } from './condense';

export { condenseCurrentWindow };

export function registerActionClickHandler(): void {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId).catch((error: unknown) => {
      console.error('Failed to condense current window:', error);
    });
  });
}

export default defineBackground(() => {
  registerActionClickHandler();
});
