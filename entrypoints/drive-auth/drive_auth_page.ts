/**
 * Google Drive auth page logic. This page lets users explicitly connect or
 * disconnect OAuth access used by manual Drive backups.
 */
import {
  formatDriveAuthError,
  getAuthToken,
  getAuthTokenSilently,
  isIdentityApiAvailable,
  removeCachedAuthToken,
  revokeToken,
} from '../drive/auth';

/** Writes status messages to the auth-page status region. */
function setStatus(statusEl: HTMLDivElement | null, message: string): void {
  if (statusEl) statusEl.textContent = message;
}

/** Enables/disables connect/disconnect actions based on current auth state. */
function applyButtonState(
  connectEl: HTMLButtonElement | null,
  disconnectEl: HTMLButtonElement | null,
  connected: boolean,
): void {
  if (connectEl) connectEl.disabled = connected;
  if (disconnectEl) disconnectEl.disabled = !connected;
}

/**
 * Initializes the Drive auth UI and wires connect/disconnect actions.
 * Uses non-interactive token checks on load so it never forces a prompt.
 */
export async function initDriveAuthPage(documentRef: Document = document): Promise<void> {
  const connectEl = documentRef.querySelector<HTMLButtonElement>('#connectDrive');
  const disconnectEl = documentRef.querySelector<HTMLButtonElement>('#disconnectDrive');
  const statusEl = documentRef.querySelector<HTMLDivElement>('#authStatus');
  if (!connectEl || !disconnectEl) return;

  if (!isIdentityApiAvailable()) {
    setStatus(statusEl, 'Google Drive auth is unavailable in this build context.');
    applyButtonState(connectEl, disconnectEl, false);
    connectEl.disabled = true;
    disconnectEl.disabled = true;
    return;
  }

  let currentToken = await getAuthTokenSilently();
  applyButtonState(connectEl, disconnectEl, Boolean(currentToken));
  setStatus(statusEl, currentToken ? 'Connected to Google Drive.' : 'Not connected.');

  connectEl.addEventListener('click', () => {
    void (async () => {
      try {
        setStatus(statusEl, 'Opening Google authentication...');
        currentToken = await getAuthToken(true);
        applyButtonState(connectEl, disconnectEl, true);
        setStatus(statusEl, 'Connected to Google Drive.');
      } catch (error) {
        const message = formatDriveAuthError(error, 'Failed to connect to Google Drive.');
        setStatus(statusEl, message);
      }
    })();
  });

  disconnectEl.addEventListener('click', () => {
    void (async () => {
      if (!currentToken) {
        setStatus(statusEl, 'No cached Google session to disconnect.');
        applyButtonState(connectEl, disconnectEl, false);
        return;
      }

      setStatus(statusEl, 'Disconnecting...');
      await removeCachedAuthToken(currentToken);
      await revokeToken(currentToken);
      currentToken = null;
      applyButtonState(connectEl, disconnectEl, false);
      setStatus(statusEl, 'Disconnected from Google Drive.');
    })();
  });
}
