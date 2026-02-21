/**
 * Settings page logic: reads current settings from storage, binds form
 * controls, and persists changes on any user interaction.
 */
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  normalizeSettings,
  readSavedGroups,
  writeSettings,
  type Settings,
  type SettingsInput,
} from '../shared/storage';
import { logExtensionError } from '../shared/utils';
import { createSnackbarNotifier, type UiNotifier } from '../ui/notifications';
import {
  formatDriveAuthError,
  getAuthToken,
  getAuthTokenSilently,
  removeCachedAuthToken,
  revokeToken,
} from '../drive/auth';
import {
  listDriveBackupsPage,
  performBackup,
  readRetentionCount,
  restoreFromBackup,
  writeRetentionCount,
} from '../drive/drive_backup';
import { normalizeRetentionCount, type DriveBackupEntry } from '../drive/types';

/** Updates the status element's text content (used for save/error feedback). */
export function setStatus(statusEl: HTMLDivElement | null, message: string): void {
  const ownerDocument = statusEl?.ownerDocument ?? document;
  const notifier = resolveDocumentToastNotifier(ownerDocument);
  notifier.notify(message);
}

/**
 * Per-document toast notifier cache.
 * A document-scoped cache keeps status writes centralized and avoids rebuilding
 * the same notifier adapter for every message.
 */
type DocumentToastNotifierCache = {
  snackbarEl: HTMLDivElement | null;
  notifier: UiNotifier;
};

const toastNotifierByDocument = new WeakMap<Document, DocumentToastNotifierCache>();

/** Resolves the options-page toast notifier for a given document. */
function resolveDocumentToastNotifier(documentRef: Document): UiNotifier {
  const snackbarEl = documentRef.querySelector<HTMLDivElement>('#snackbar');
  const cached = toastNotifierByDocument.get(documentRef);
  if (cached && cached.snackbarEl === snackbarEl) return cached.notifier;
  const notifier = createSnackbarNotifier(snackbarEl);
  toastNotifierByDocument.set(documentRef, { snackbarEl, notifier });
  return notifier;
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
  /** Default restore page size used when dropdown input is unavailable/invalid. */
  const DEFAULT_RESTORE_LIST_PAGE_SIZE = 10;
  const driveSectionEl = documentRef.querySelector<HTMLElement>('.drive-backup');
  const openAuthEl = documentRef.querySelector<HTMLButtonElement>('#openDriveAuth');
  const backupNowEl = documentRef.querySelector<HTMLButtonElement>('#backupNow');
  const openRestoreEl = documentRef.querySelector<HTMLButtonElement>('#openDriveRestore');
  const retentionEl = documentRef.querySelector<HTMLInputElement>('#driveRetentionCount');
  const backupListEl = documentRef.querySelector<HTMLTableSectionElement>('#driveBackupList');
  const restorePageSizeEl = documentRef.querySelector<HTMLSelectElement>('#driveRestorePageSize');
  const loadMoreBackupsEl = documentRef.querySelector<HTMLButtonElement>('#loadMoreDriveBackups');
  const driveStatusEl = documentRef.querySelector<HTMLDivElement>('#driveStatus');
  const driveRestoreDialogEl = documentRef.querySelector<HTMLDialogElement>('#driveRestoreDialog');
  const closeDriveRestoreEl = documentRef.querySelector<HTMLButtonElement>('#closeDriveRestore');

  if (
    !openAuthEl ||
    !backupNowEl ||
    !openRestoreEl ||
    !retentionEl ||
    !backupListEl ||
    !restorePageSizeEl ||
    !loadMoreBackupsEl ||
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
    | 'loading_more_restore_list'
    | 'restore'
    | null;
  let busyReason: DriveBusyReason = null;
  let isConnected = false;
  let currentToken: string | null = null;
  let restoreBackups: DriveBackupEntry[] = [];
  let nextRestorePageToken: string | null = null;

  /**
   * Reads selected restore page size from modal UI.
   * Falls back to a safe default when DOM value is malformed.
   */
  const getRestoreListPageSize = (): number => {
    const parsed = Number(restorePageSizeEl.value);
    if (!Number.isFinite(parsed)) return DEFAULT_RESTORE_LIST_PAGE_SIZE;
    const normalized = Math.floor(parsed);
    return normalized > 0 ? normalized : DEFAULT_RESTORE_LIST_PAGE_SIZE;
  };

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

  /** Computes label for modal pagination action so users can tell when additional pages are loading. */
  const getLoadMoreButtonLabel = () => {
    if (busyReason === 'loading_more_restore_list') return 'Loading more backups...';
    return 'Load more backups';
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
    restorePageSizeEl.disabled = busy;
    setRestoreButtonsDisabled(busy || !isConnected);
    loadMoreBackupsEl.disabled = busy || !isConnected || !nextRestorePageToken;
    loadMoreBackupsEl.hidden = nextRestorePageToken === null;
    loadMoreBackupsEl.textContent = getLoadMoreButtonLabel();

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
        /**
         * Backup uploads are only meaningful when at least one saved group exists.
         * This early return prevents empty backup files and gives immediate, clear feedback.
         */
        const groups = await readSavedGroups();
        const groupCount = Object.keys(groups).length;
        if (groupCount === 0) {
          setStatus(driveStatusEl, 'Nothing to backup.');
          return;
        }
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
        const page = await listDriveBackupsPage(token, undefined, getRestoreListPageSize());
        restoreBackups = page.backups;
        nextRestorePageToken = page.nextPageToken;
        renderDriveBackups(backupListEl, restoreBackups);
        applyDriveUiState();
        openRestoreDialog();
        setStatus(
          driveStatusEl,
          restoreBackups.length > 0
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

  /**
   * Fetches the next restore-list page only when users request more rows.
   * This keeps list rendering responsive even for accounts with many backups.
   */
  loadMoreBackupsEl.addEventListener('click', () => {
    void (async () => {
      if (!nextRestorePageToken) return;
      setBusyReason('loading_more_restore_list');
      setStatus(driveStatusEl, 'Loading more backups...');
      try {
        const token = await resolveConnectedToken();
        const page = await listDriveBackupsPage(token, nextRestorePageToken, getRestoreListPageSize());
        const seenIds = new Set(restoreBackups.map((entry) => entry.fileId));
        const uniqueNext = page.backups.filter((entry) => !seenIds.has(entry.fileId));
        restoreBackups = [...restoreBackups, ...uniqueNext];
        nextRestorePageToken = page.nextPageToken;
        renderDriveBackups(backupListEl, restoreBackups);
        setStatus(
          driveStatusEl,
          nextRestorePageToken
            ? `Loaded ${restoreBackups.length} backup${restoreBackups.length === 1 ? '' : 's'}.`
            : `Loaded all ${restoreBackups.length} backup${restoreBackups.length === 1 ? '' : 's'}.`,
        );
      } catch (error) {
        const message = formatDriveAuthError(error, 'Failed to load more backups.');
        setStatus(driveStatusEl, message);
      } finally {
        setBusyReason(null);
        applyDriveUiState();
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
  restoreBackups = [];
  nextRestorePageToken = null;
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
  const duplicateTabsPolicyRadios = Array.from(
    documentRef.querySelectorAll<HTMLInputElement>('input[name="duplicateTabsPolicy"]'),
  );
  const themeRadios = Array.from(
    documentRef.querySelectorAll<HTMLInputElement>('input[name="theme"]'),
  );
  const statusEl = documentRef.querySelector<HTMLDivElement>('#status');

  if (
    !excludePinnedEl ||
    !restoreBatchSizeEl ||
    discardRadios.length === 0 ||
    duplicateTabsPolicyRadios.length === 0 ||
    themeRadios.length === 0
  ) {
    return;
  }

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
  const setDuplicateTabsPolicyRadios = (policy: Settings['duplicateTabsPolicy']) => {
    for (const radio of duplicateTabsPolicyRadios) {
      radio.checked = radio.value === policy;
    }
  };
  const getDuplicateTabsPolicySelection = (): Settings['duplicateTabsPolicy'] => {
    const selected = duplicateTabsPolicyRadios.find((radio) => radio.checked);
    return selected?.value === 'reject' ? 'reject' : 'allow';
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
  setDuplicateTabsPolicyRadios(settings.duplicateTabsPolicy);
  setThemeRadios(settings.theme);
  applyTheme(settings.theme);

  let customBatchSize = hasCustomBatchSize;

  const saveSettings = async (nextSettings: SettingsInput) => {
    const saved = await writeSettings(nextSettings);
    if (!saved) {
      excludePinnedEl.checked = settings.excludePinned;
      restoreBatchSizeEl.value = customBatchSize ? String(settings.restoreBatchSize) : '';
      setDiscardRadios(settings.discardRestoredTabs);
      setDuplicateTabsPolicyRadios(settings.duplicateTabsPolicy);
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
      duplicateTabsPolicy:
        nextSettings.duplicateTabsPolicy === 'allow' || nextSettings.duplicateTabsPolicy === 'reject'
          ? nextSettings.duplicateTabsPolicy
          : DEFAULT_SETTINGS.duplicateTabsPolicy,
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
      duplicateTabsPolicy: getDuplicateTabsPolicySelection(),
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
  for (const radio of duplicateTabsPolicyRadios) {
    radio.addEventListener('change', () => {
      runUpdate();
    });
  }

  await initDriveBackupSection(documentRef);
}
