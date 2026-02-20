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
