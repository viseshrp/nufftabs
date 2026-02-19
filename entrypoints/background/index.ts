/**
 * Background service worker entrypoint for the nufftabs extension.
 * Registers the browser-action click handler that triggers the condense workflow.
 */
import { condenseCurrentWindow } from './condense';
import { logExtensionError } from '../shared/utils';

/** Re-export so other modules can import `condenseCurrentWindow` from the background barrel. */
export { condenseCurrentWindow };

/** Registers a `chrome.action.onClicked` listener that condenses all eligible tabs in the clicked window. */
export function registerActionClickHandler(): void {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId).catch((error: unknown) => {
      logExtensionError('Failed to condense current window', error, 'error');
    });
  });
}

/** WXT background entrypoint — invoked once when the service worker starts. */
export default defineBackground(() => {
  registerActionClickHandler();
});
