import { condenseCurrentWindow } from './condense';
import { logExtensionError, logit, debounce } from '../shared/utils';
import { authenticate, uploadFile } from '../shared/google_drive';
import {
  readSavedGroups,
  readSettings,
  writeSettings,
  isSavedGroupStorageKey,
  STORAGE_KEYS,
} from '../shared/storage';

export { condenseCurrentWindow };

async function performBackup(): Promise<void> {
  try {
    const settings = await readSettings();
    if (!settings.googleDriveBackup.enabled) return;

    // Attempt to get a valid OAuth token without prompting the user.
    // If the user is not signed in or hasn't authorized the app, this will fail silently.
    const token = await authenticate(false).catch(() => null);
    if (!token) {
      // Not authenticated, so we cannot perform the backup.
      return;
    }

    // Read all saved tab groups from storage.
    const savedGroups = await readSavedGroups();
    // Serialize the tab groups to a JSON string with indentation for readability.
    const content = JSON.stringify({ savedTabs: savedGroups }, null, 2);

    // Upload the content to Google Drive.
    // This will either create a new file or overwrite an existing one based on the settings.
    await uploadFile(
      token,
      content,
      settings.googleDriveBackup.filename,
      settings.googleDriveBackup.mode,
    );

    // Update the last sync timestamp in settings.
    // We use a partial update to avoid overwriting other settings that might have changed concurrently.
    await writeSettings({
      googleDriveBackup: { lastSync: Date.now() },
    });

    logit('Backup to Google Drive completed successfully.');
  } catch (error) {
    logExtensionError('Failed to perform Google Drive backup', error);
  }
}

const debouncedBackup = debounce(performBackup, 5000);

function registerStorageListener(): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const changeKeys = Object.keys(changes);
    const hasSavedTabsChange =
      Boolean(changes[STORAGE_KEYS.savedTabsIndex]) ||
      changeKeys.some((key) => isSavedGroupStorageKey(key));

    if (hasSavedTabsChange) {
      debouncedBackup();
    }
  });
}

export function registerActionClickHandler(): void {
  chrome.action.onClicked.addListener((tab) => {
    void condenseCurrentWindow(tab?.windowId).catch((error: unknown) => {
      logExtensionError('Failed to condense current window', error, 'error');
    });
  });
}

export default defineBackground(() => {
  registerActionClickHandler();
  registerStorageListener();
});
