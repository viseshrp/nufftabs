import { condenseCurrentWindow } from './condense';
import { logExtensionError } from '../shared/utils';

export { condenseCurrentWindow };

export function registerActionClickHandler(): void {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId).catch((error: unknown) => {
      logExtensionError('Failed to condense current window', error, 'error');
    });
  });
}

export default defineBackground(() => {
  registerActionClickHandler();
});
