/**
 * Settings page logic: reads current settings from storage, binds form
 * controls, and persists changes on any user interaction.
 */
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  normalizeSettings,
  writeSettings,
  type Settings,
  type SettingsInput,
} from '../shared/storage';
import { logExtensionError } from '../shared/utils';
import {
  formatDriveAuthError,
  getAuthToken,
  getAuthTokenSilently,
  removeCachedAuthToken,
  revokeToken,
} from '../drive/auth';
import {
  getBackupsWithFallback,
  performBackup,
  readRetentionCount,
  restoreFromBackup,
  writeRetentionCount,
} from '../drive/drive_backup';
import { normalizeRetentionCount, type DriveBackupEntry } from '../drive/types';

/** Updates the status element's text content (used for save/error feedback). */
export function setStatus(statusEl: HTMLDivElement | null, message: string): void {
  if (statusEl) statusEl.textContent = message;
}

/** Parses and validates the batch-size input, returning null if empty or invalid. */
export function getBatchSizeInput(input: HTMLInputElement): number | null {
  const rawValue = input.value.trim();
  if (rawValue.length === 0) return null;
  const rawNumber = Number(rawValue);
  if (!Number.isFinite(rawNumber)) return null;
  const parsed = Math.floor(rawNumber);
  return parsed > 0 ? parsed : null;
}

/** Formats epoch-ms timestamps into locale-friendly date/time strings for backup rows. */
function formatBackupTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown';
  return new Date(timestamp).toLocaleString();
}

/** Formats byte counts for backup rows without external dependencies. */
function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 || unitIndex === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

/** Renders the Drive backup table body from current backup metadata. */
function renderDriveBackups(listEl: HTMLTableSectionElement | null, backups: DriveBackupEntry[]): void {
  if (!listEl) return;

  if (backups.length === 0) {
    listEl.innerHTML = '<tr><td class="row-empty" colspan="4">No backups found yet.</td></tr>';
    return;
  }

  const rows = backups
    .map((entry) => {
      const when = formatBackupTimestamp(entry.timestamp);
      const groups = entry.tabGroupCount;
      const size = formatBytes(entry.size);
      return [
        '<tr>',
        `<td>${when}</td>`,
        `<td>${groups}</td>`,
        `<td>${size}</td>`,
        '<td>',
        `<button type="button" data-action="restore-backup" data-file-id="${entry.fileId}">Restore</button>`,
        '</td>',
        '</tr>',
      ].join('');
    })
    .join('');

  listEl.innerHTML = rows;
}

/**
 * Initializes the optional Drive backup section in options UI.
 * This section is intentionally isolated so missing elements never break base settings.
 */
async function initDriveBackupSection(documentRef: Document): Promise<void> {
  const driveSectionEl = documentRef.querySelector<HTMLElement>('.drive-backup');
  const openAuthEl = documentRef.querySelector<HTMLButtonElement>('#openDriveAuth');
  const backupNowEl = documentRef.querySelector<HTMLButtonElement>('#backupNow');
  const openRestoreEl = documentRef.querySelector<HTMLButtonElement>('#openDriveRestore');
  const retentionEl = documentRef.querySelector<HTMLInputElement>('#driveRetentionCount');
  const backupListEl = documentRef.querySelector<HTMLTableSectionElement>('#driveBackupList');
  const driveStatusEl = documentRef.querySelector<HTMLDivElement>('#driveStatus');
  const driveRestoreDialogEl = documentRef.querySelector<HTMLDialogElement>('#driveRestoreDialog');
  const closeDriveRestoreEl = documentRef.querySelector<HTMLButtonElement>('#closeDriveRestore');

  if (
    !openAuthEl ||
    !backupNowEl ||
    !openRestoreEl ||
    !retentionEl ||
    !backupListEl ||
    !driveRestoreDialogEl ||
    !closeDriveRestoreEl
  ) {
    return;
  }

  /**
   * Small local state model for the Drive subsection.
   * Keeping this centralized avoids split/implicit UI logic and makes updates predictable.
   */
  type DriveBusyReason =
    | 'loading'
    | 'connecting'
    | 'disconnecting'
    | 'backup'
    | 'loading_restore_list'
    | 'restore'
    | null;
  let busyReason: DriveBusyReason = null;
  let isConnected = false;
  let currentToken: string | null = null;

  /** Enables/disables all restore buttons rendered in the current backup table body. */
  const setRestoreButtonsDisabled = (disabled: boolean) => {
    const restoreButtons = backupListEl.querySelectorAll<HTMLButtonElement>('button[data-action="restore-backup"]');
    for (const restoreButton of restoreButtons) {
      restoreButton.disabled = disabled;
    }
  };

  /** Computes the connect button label from current connection + operation state. */
  const getConnectButtonLabel = () => {
    if (busyReason === 'loading') return 'Checking Google Drive...';
    if (busyReason === 'connecting') return 'Connecting to Google Drive...';
    if (busyReason === 'disconnecting') return 'Disconnecting Google Drive...';
    if (isConnected) return 'Connected to Google Drive (Disconnect)';
    return 'Connect to Google Drive';
  };

  /** Computes the backup button label so users get immediate progress feedback while running uploads. */
  const getBackupButtonLabel = () => {
    if (busyReason === 'backup') return 'Backing up...';
    return 'Backup now';
  };

  /** Computes the restore button label so backup-list loading/restoring progress is visible without opening the dialog first. */
  const getRestoreButtonLabel = () => {
    if (busyReason === 'loading_restore_list') return 'Loading backups...';
    if (busyReason === 'restore') return 'Restoring...';
    return 'Restore from backup';
  };

  /** Opens restore dialog safely in both real browser runtime and test/runtime contexts without `showModal`. */
  const openRestoreDialog = () => {
    if (typeof driveRestoreDialogEl.showModal === 'function') {
      driveRestoreDialogEl.showModal();
      return;
    }
    driveRestoreDialogEl.setAttribute('open', '');
  };

  /** Closes restore dialog safely in both real browser runtime and test/runtime contexts without `close`. */
  const closeRestoreDialog = () => {
    if (typeof driveRestoreDialogEl.close === 'function') {
      driveRestoreDialogEl.close();
      return;
    }
    driveRestoreDialogEl.removeAttribute('open');
  };

  /**
   * Resolves a valid token for restore listing.
   * If no cached token is present, request one interactively so users can proceed immediately.
   */
  const resolveConnectedToken = async () => {
    if (currentToken) return currentToken;
    const token = await getAuthToken(true);
    currentToken = token;
    isConnected = true;
    return token;
  };

  /**
   * Applies UI state in one place so controls stay consistent:
   * - Connect button shows status and active operation directly in its own label.
   * - Backup/restore actions are disabled whenever disconnected or busy.
   */
  const applyDriveUiState = () => {
    const busy = busyReason !== null;
    openAuthEl.textContent = getConnectButtonLabel();
    openAuthEl.disabled = busy;
    openAuthEl.dataset.connected = isConnected ? 'true' : 'false';
    openAuthEl.dataset.busy = busy ? 'true' : 'false';
    backupNowEl.disabled = busy || !isConnected;
    backupNowEl.textContent = getBackupButtonLabel();
    openRestoreEl.disabled = busy || !isConnected;
    openRestoreEl.textContent = getRestoreButtonLabel();
    retentionEl.disabled = busy;
    setRestoreButtonsDisabled(busy || !isConnected);

    if (!driveSectionEl) return;
    driveSectionEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    driveSectionEl.dataset.connected = isConnected ? 'true' : 'false';
  };

  /** Updates the current busy reason and reapplies button/section state in one call. */
  const setBusyReason = (nextBusyReason: DriveBusyReason) => {
    busyReason = nextBusyReason;
    applyDriveUiState();
  };

  const refreshAuthState = async () => {
    const token = await getAuthTokenSilently();
    currentToken = token;
    isConnected = Boolean(token);
    applyDriveUiState();
  };

  const retention = await readRetentionCount();
  retentionEl.value = String(retention);

  openAuthEl.addEventListener('click', () => {
    void (async () => {
      try {
        if (!isConnected) {
          setBusyReason('connecting');
          setStatus(driveStatusEl, 'Opening Google authentication...');
          currentToken = await getAuthToken(true);
          isConnected = true;
          setStatus(driveStatusEl, 'Connected to Google Drive. You can back up or restore now.');
          return;
        }

        setBusyReason('disconnecting');
        if (currentToken) {
          await removeCachedAuthToken(currentToken);
          await revokeToken(currentToken);
        }
        currentToken = null;
        isConnected = false;
        setStatus(driveStatusEl, 'Disconnected from Google Drive. Connect again to back up or restore.');
      } catch (error) {
        const fallback = isConnected
          ? 'Failed to disconnect from Google Drive.'
          : 'Failed to connect to Google Drive.';
        const message = formatDriveAuthError(error, fallback);
        setStatus(driveStatusEl, message);
      } finally {
        setBusyReason(null);
        await refreshAuthState();
      }
    })();
  });

  retentionEl.addEventListener('change', () => {
    void (async () => {
      const normalized = normalizeRetentionCount(Number(retentionEl.value));
      const saved = await writeRetentionCount(normalized);
      retentionEl.value = String(saved);
      setStatus(driveStatusEl, `Retention saved: keep latest ${saved} backup${saved === 1 ? '' : 's'}.`);
    })().catch((error) => {
      logExtensionError('Failed to save Drive retention setting', error, { operation: 'runtime_context' });
      setStatus(driveStatusEl, 'Failed to save retention setting.');
    });
  });

  backupNowEl.addEventListener('click', () => {
    void (async () => {
      setBusyReason('backup');
      setStatus(driveStatusEl, 'Starting backup...');

      try {
        const token = await getAuthToken(true);
        currentToken = token;
        isConnected = true;
        const retentionCount = await writeRetentionCount(normalizeRetentionCount(Number(retentionEl.value)));
        const backups = await performBackup(token, retentionCount);
        retentionEl.value = String(retentionCount);
        setStatus(driveStatusEl, `Backup completed. ${backups.length} backup${backups.length === 1 ? '' : 's'} stored.`);
      } catch (error) {
        const message = formatDriveAuthError(error, 'Backup failed.');
        setStatus(driveStatusEl, message);
      } finally {
        setBusyReason(null);
        await refreshAuthState();
      }
    })();
  });

  /**
   * Restore list is fetched lazily only when users explicitly request restore.
   * This keeps options lightweight and avoids loading backup metadata until needed.
   */
  openRestoreEl.addEventListener('click', () => {
    void (async () => {
      setBusyReason('loading_restore_list');
      setStatus(driveStatusEl, 'Loading backups...');
      try {
        const token = await resolveConnectedToken();
        const backups = await getBackupsWithFallback(token);
        renderDriveBackups(backupListEl, backups);
        applyDriveUiState();
        openRestoreDialog();
        setStatus(
          driveStatusEl,
          backups.length > 0
            ? 'Choose a backup to restore.'
            : 'No backups found. Create a backup first, then restore it here.',
        );
      } catch (error) {
        const message = formatDriveAuthError(error, 'Failed to load backup list.');
        setStatus(driveStatusEl, message);
      } finally {
        setBusyReason(null);
        await refreshAuthState();
      }
    })();
  });

  closeDriveRestoreEl.addEventListener('click', () => {
    closeRestoreDialog();
  });

  backupListEl.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest<HTMLButtonElement>('button[data-action="restore-backup"]');
    if (!button) return;

    const fileId = button.dataset.fileId;
    if (!fileId) return;

    void (async () => {
      setBusyReason('restore');
      setStatus(driveStatusEl, 'Restoring backup...');

      try {
        const token = await getAuthToken(true);
        currentToken = token;
        isConnected = true;
        const restored = await restoreFromBackup(fileId, token);
        closeRestoreDialog();
        setStatus(
          driveStatusEl,
          `Restore completed. ${restored.restoredTabs} tab${restored.restoredTabs === 1 ? '' : 's'} across ${restored.restoredGroups} group${restored.restoredGroups === 1 ? '' : 's'}.`,
        );
      } catch (error) {
        const message = formatDriveAuthError(error, 'Restore failed.');
        setStatus(driveStatusEl, message);
      } finally {
        setBusyReason(null);
        await refreshAuthState();
      }
    })();
  });

  /**
   * Keep auth status fresh when returning to the options tab.
   * This removes the need for manual page refreshes after auth completes elsewhere.
   */
  const refreshAuthStateOnVisibility = () => {
    void refreshAuthState();
  };

  documentRef.addEventListener('visibilitychange', refreshAuthStateOnVisibility);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', refreshAuthStateOnVisibility);
  }

  setBusyReason('loading');
  setStatus(driveStatusEl, 'Checking Google Drive connection...');
  renderDriveBackups(backupListEl, []);
  await refreshAuthState();
  setBusyReason(null);
  if (!isConnected) {
    setStatus(driveStatusEl, 'Not connected. Connect Google Drive to back up or restore.');
  } else {
    setStatus(driveStatusEl, 'Connected to Google Drive. Ready to back up or restore.');
  }
}

/**
 * Initializes the settings page: reads persisted settings, populates form
 * controls, and attaches change listeners that auto-save on interaction.
 */
export async function initSettingsPage(documentRef: Document = document): Promise<void> {
  const excludePinnedEl = documentRef.querySelector<HTMLInputElement>('#excludePinned');
  const restoreBatchSizeEl = documentRef.querySelector<HTMLInputElement>('#restoreBatchSize');
  const discardRadios = Array.from(
    documentRef.querySelectorAll<HTMLInputElement>('input[name="discardRestoredTabs"]'),
  );
  const themeRadios = Array.from(
    documentRef.querySelectorAll<HTMLInputElement>('input[name="theme"]'),
  );
  const statusEl = documentRef.querySelector<HTMLDivElement>('#status');

  if (!excludePinnedEl || !restoreBatchSizeEl || discardRadios.length === 0 || themeRadios.length === 0) return;

  const setDiscardRadios = (enabled: boolean) => {
    for (const radio of discardRadios) {
      radio.checked = radio.value === String(enabled);
    }
  };

  const setThemeRadios = (theme: Settings['theme']) => {
    for (const radio of themeRadios) {
      radio.checked = radio.value === theme;
    }
  };

  const getDiscardSelection = () => {
    const selected = discardRadios.find((radio) => radio.checked);
    return selected?.value === 'true';
  };

  const getThemeSelection = (): Settings['theme'] => {
    const selected = themeRadios.find((radio) => radio.checked);
    const val = selected?.value;
    if (val === 'light' || val === 'dark') return val;
    return 'os';
  };

  const applyTheme = (theme: Settings['theme']) => {
    if (theme === 'os') {
      documentRef.documentElement.removeAttribute('data-theme');
    } else {
      documentRef.documentElement.setAttribute('data-theme', theme);
    }
  };

  const getRestoreBatchSizeSetting = () => {
    const parsed = getBatchSizeInput(restoreBatchSizeEl);
    return parsed ?? undefined;
  };
  const raw = await chrome.storage.local.get([STORAGE_KEYS.settings]);
  const rawSettings = raw[STORAGE_KEYS.settings];
  const hasCustomBatchSize =
    rawSettings &&
    typeof rawSettings === 'object' &&
    typeof (rawSettings as { restoreBatchSize?: unknown }).restoreBatchSize === 'number' &&
    Number.isFinite((rawSettings as { restoreBatchSize?: unknown }).restoreBatchSize);

  let settings: Settings = normalizeSettings(rawSettings);
  excludePinnedEl.checked = settings.excludePinned;
  restoreBatchSizeEl.value = hasCustomBatchSize ? String(settings.restoreBatchSize) : '';
  setDiscardRadios(settings.discardRestoredTabs);
  setThemeRadios(settings.theme);
  applyTheme(settings.theme);

  let customBatchSize = hasCustomBatchSize;

  const saveSettings = async (nextSettings: SettingsInput) => {
    const saved = await writeSettings(nextSettings);
    if (!saved) {
      excludePinnedEl.checked = settings.excludePinned;
      restoreBatchSizeEl.value = customBatchSize ? String(settings.restoreBatchSize) : '';
      setDiscardRadios(settings.discardRestoredTabs);
      setThemeRadios(settings.theme);
      applyTheme(settings.theme);
      setStatus(statusEl, 'Failed to save settings.');
      return;
    }
    settings = {
      excludePinned: nextSettings.excludePinned,
      restoreBatchSize:
        typeof nextSettings.restoreBatchSize === 'number' && Number.isFinite(nextSettings.restoreBatchSize)
          ? Math.floor(nextSettings.restoreBatchSize)
          : DEFAULT_SETTINGS.restoreBatchSize,
      discardRestoredTabs:
        typeof nextSettings.discardRestoredTabs === 'boolean'
          ? nextSettings.discardRestoredTabs
          : DEFAULT_SETTINGS.discardRestoredTabs,
      theme: nextSettings.theme ?? settings.theme,
    };
    customBatchSize =
      typeof nextSettings.restoreBatchSize === 'number' && Number.isFinite(nextSettings.restoreBatchSize);
    applyTheme(settings.theme);
    setStatus(statusEl, 'Settings saved.');
  };

  const updateSettings = async () => {
    const nextSettings: SettingsInput = {
      excludePinned: excludePinnedEl.checked,
      restoreBatchSize: getRestoreBatchSizeSetting(),
      discardRestoredTabs: getDiscardSelection(),
      theme: getThemeSelection(),
    };
    await saveSettings(nextSettings);
    // Explicitly clear invalid input if parsing failed (returned undefined)
    if (!nextSettings.restoreBatchSize) {
      restoreBatchSizeEl.value = '';
    }
  };

  const runUpdate = () => {
    void updateSettings().catch((error) => {
      logExtensionError('Failed to update settings from options UI', error, { operation: 'runtime_context' });
    });
  };

  excludePinnedEl.addEventListener('change', () => {
    runUpdate();
  });

  restoreBatchSizeEl.addEventListener('change', () => {
    runUpdate();
  });

  restoreBatchSizeEl.addEventListener('blur', () => {
    runUpdate();
  });

  for (const radio of discardRadios) {
    radio.addEventListener('change', () => {
      runUpdate();
    });
  }

  for (const radio of themeRadios) {
    radio.addEventListener('change', () => {
      runUpdate();
    });
  }

  await initDriveBackupSection(documentRef);
}
