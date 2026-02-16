import { condenseCurrentWindow } from './condense';

export { condenseCurrentWindow };

export function registerActionClickHandler(): void {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId);
  });
}

export default defineBackground(() => {
  registerActionClickHandler();
});
