import { logit } from './utils';

const MULTIPART_BOUNDARY = 'foo_bar_baz';
const DELIMITER = `\r\n--${MULTIPART_BOUNDARY}\r\n`;
const CLOSE_DELIMITER = `\r\n--${MULTIPART_BOUNDARY}--`;

export async function authenticate(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (token) {
        resolve(token);
      } else {
        reject(new Error('Failed to retrieve token'));
      }
    });
  });
}

export async function getProfileUserInfo(token: string): Promise<{ email: string; name: string; picture: string }> {
  const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch user info: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Searches for a file by name in the root directory of Google Drive.
 * @param token The OAuth 2.0 access token.
 * @param filename The name of the file to search for.
 * @returns The ID of the first matching file, or null if not found.
 */
export async function findFile(token: string, filename: string): Promise<string | null> {
  // Escape single quotes in filename to prevent query injection or syntax errors
  const safeFilename = filename.replace(/'/g, "\\'");
  const query = `name = '${safeFilename}' and trashed = false and 'root' in parents`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id, name)`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to find file: ${response.statusText}`);
  }
  const data = await response.json();
  if (data.files && data.files.length > 0) {
    return data.files[0].id; // Return the first matching file ID
  }
  return null;
}

export async function uploadFile(
  token: string,
  content: string,
  filename: string,
  mode: 'overwrite' | 'new',
): Promise<void> {
  let fileId: string | null = null;

  if (mode === 'overwrite') {
    try {
      fileId = await findFile(token, filename);
    } catch (error) {
      logit(`Error finding file: ${error}`);
      // Fallback to creating a new file if find fails? Or stop?
      // If we can't find it, we probably can't overwrite it.
      // But maybe it doesn't exist yet, so we create it.
    }
  }

  const metadata = {
    name: filename,
    mimeType: 'application/json',
  };

  const multipartRequestBody =
    `${DELIMITER}Content-Type: application/json\r\n\r\n${JSON.stringify(metadata)}${DELIMITER}Content-Type: application/json\r\n\r\n${content}${CLOSE_DELIMITER}`;

  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  let method = 'POST';

  if (fileId) {
    url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
    method = 'PATCH';
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${MULTIPART_BOUNDARY}`,
    },
    body: multipartRequestBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload file: ${response.status} ${response.statusText} - ${errorText}`);
  }
}

export async function clearCachedToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, () => {
      resolve();
    });
  });
}
