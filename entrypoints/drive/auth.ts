/**
 * Thin wrappers around `chrome.identity` callback APIs so the rest of the code
 * can use simple Promise-based auth helpers.
 */

/** Returns true when the identity API is available in the current runtime context. */
export function isIdentityApiAvailable(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.identity?.getAuthToken === 'function';
}

/**
 * Requests an OAuth token via Chrome identity.
 * When `interactive` is false, this checks existing cached auth only.
 */
export async function getAuthToken(interactive: boolean): Promise<string> {
  if (!isIdentityApiAvailable()) {
    throw new Error('Google Drive auth is unavailable in this context.');
  }

  return new Promise<string>((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (tokenResult) => {
      const message = chrome.runtime.lastError?.message;
      if (message) {
        reject(new Error(message));
        return;
      }
      const token =
        typeof tokenResult === 'string'
          ? tokenResult
          : tokenResult &&
              typeof tokenResult === 'object' &&
              typeof (tokenResult as { token?: unknown }).token === 'string'
            ? ((tokenResult as { token: string }).token ?? '')
            : '';
      if (token.length === 0) {
        reject(new Error('No auth token returned by chrome.identity.'));
        return;
      }
      resolve(token);
    });
  });
}

/**
 * Converts OAuth/identity failures into user-actionable guidance while
 * preserving original non-auth error messages.
 */
export function formatDriveAuthError(error: unknown, fallbackMessage: string): string {
  const rawMessage = error instanceof Error ? error.message.trim() : '';
  if (rawMessage.length === 0) return fallbackMessage;

  const normalized = rawMessage.toLowerCase();
  if (!normalized.includes('bad client id')) return rawMessage;

  const extensionId = typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : 'unknown';
  return [
    'Google Drive OAuth is misconfigured for this build.',
    `Set GOOGLE_OAUTH_CLIENT_ID to a Chrome Extension OAuth client for extension ID ${extensionId}.`,
    'Set CHROME_EXTENSION_KEY (or EXTENSION_MANIFEST_KEY), then restart dev/build and reload the extension.',
  ].join(' ');
}

/**
 * Best-effort non-interactive auth check. Returns `null` instead of throwing
 * when no cached token is currently available.
 */
export async function getAuthTokenSilently(): Promise<string | null> {
  try {
    return await getAuthToken(false);
  } catch {
    return null;
  }
}

/** Removes a token from the Chrome identity token cache. */
export async function removeCachedAuthToken(token: string): Promise<void> {
  if (!isIdentityApiAvailable()) return;
  await new Promise<void>((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      resolve();
    });
  });
}

/**
 * Revokes a token at Google's OAuth revoke endpoint.
 * Errors are intentionally ignored because cache removal is already completed.
 */
export async function revokeToken(token: string): Promise<void> {
  if (typeof fetch !== 'function') return;
  try {
    const url = `https://accounts.google.com/o/oauth2/revoke?token=${encodeURIComponent(token)}`;
    await fetch(url, { method: 'POST' });
  } catch {
    // Ignore revoke failures because local disconnect state already cleared.
  }
}
