/**
 * Minimal Google Drive REST client used by the backup feature.
 * The functions are intentionally stateless and accept OAuth tokens explicitly
 * so they are easy to unit-test and safe to call from any extension page.
 */
import type { DriveFileRecord } from './types';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Escapes single quotes and backslashes in Drive query string literals. */
function escapeDriveQueryLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Builds auth headers shared by all Drive API requests. */
function buildAuthHeaders(token: string, extra?: Record<string, string>): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    ...(extra ?? {}),
  });
  return headers;
}

/**
 * Parses a Drive API JSON response and throws an error with useful context on
 * non-success status codes.
 */
async function parseJsonResponse<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    let details = '';
    try {
      details = await response.text();
    } catch {
      details = '';
    }
    throw new Error(`${context} failed (${response.status}): ${details}`.trim());
  }
  return (await response.json()) as T;
}

/**
 * Lists files in a Drive folder, sorted by filename descending so newest
 * timestamped backup names appear first.
 */
export async function listFiles(folderId: string, token: string): Promise<DriveFileRecord[]> {
  const allFiles: DriveFileRecord[] = [];
  let nextPageToken: string | undefined;
  const query = [`'${escapeDriveQueryLiteral(folderId)}' in parents`, "trashed = false"].join(' and ');
  do {
    const params = new URLSearchParams({
      q: query,
      orderBy: 'name desc',
      pageSize: '200',
      fields: 'nextPageToken,files(id,name,createdTime,modifiedTime,size)',
      supportsAllDrives: 'false',
    });
    if (nextPageToken) params.set('pageToken', nextPageToken);

    const response = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
      method: 'GET',
      headers: buildAuthHeaders(token),
    });

    const data = await parseJsonResponse<{ files?: DriveFileRecord[]; nextPageToken?: string }>(
      response,
      'Drive list files',
    );
    if (Array.isArray(data.files)) allFiles.push(...data.files);
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return allFiles;
}

/**
 * Finds an existing folder by name (and optional parent), creating it when it
 * does not exist. Returns the folder file ID.
 */
export async function getOrCreateFolder(name: string, token: string, parentId?: string): Promise<string> {
  const clauses = [
    `name = '${escapeDriveQueryLiteral(name)}'`,
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    'trashed = false',
  ];
  if (typeof parentId === 'string' && parentId.length > 0) {
    clauses.push(`'${escapeDriveQueryLiteral(parentId)}' in parents`);
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    orderBy: 'createdTime desc',
    pageSize: '1',
    fields: 'files(id,name)',
    supportsAllDrives: 'false',
  });

  const listResponse = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    method: 'GET',
    headers: buildAuthHeaders(token),
  });
  const listed = await parseJsonResponse<{ files?: Array<{ id?: string }> }>(listResponse, 'Drive find folder');
  const existingId = listed.files?.[0]?.id;
  if (typeof existingId === 'string' && existingId.length > 0) return existingId;

  const payload: {
    name: string;
    mimeType: string;
    parents?: string[];
  } = {
    name,
    mimeType: DRIVE_FOLDER_MIME,
  };
  if (typeof parentId === 'string' && parentId.length > 0) {
    payload.parents = [parentId];
  }

  const createResponse = await fetch(`${DRIVE_API_BASE}/files?supportsAllDrives=false`, {
    method: 'POST',
    headers: buildAuthHeaders(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  });
  const created = await parseJsonResponse<{ id?: string }>(createResponse, 'Drive create folder');

  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('Drive create folder returned no folder ID.');
  }
  return created.id;
}

/**
 * Uploads a JSON file via multipart upload and returns Drive metadata for the
 * created file.
 */
export async function uploadJsonFile(
  name: string,
  content: string,
  folderId: string,
  token: string,
): Promise<DriveFileRecord> {
  const boundary = `nufftabs-${crypto.randomUUID()}`;
  const metadata = {
    name,
    mimeType: 'application/json',
    parents: [folderId],
  };

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const response = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,createdTime,modifiedTime,size&supportsAllDrives=false`,
    {
      method: 'POST',
      headers: buildAuthHeaders(token, {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      }),
      body,
    },
  );

  const created = await parseJsonResponse<DriveFileRecord>(response, 'Drive upload file');
  if (typeof created.id !== 'string' || created.id.length === 0) {
    throw new Error('Drive upload file returned no file ID.');
  }
  if (typeof created.name !== 'string' || created.name.length === 0) {
    throw new Error('Drive upload file returned no file name.');
  }
  return created;
}

/** Downloads and parses a JSON backup file by Drive file ID. */
export async function downloadJsonFile(fileId: string, token: string): Promise<unknown> {
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`, {
    method: 'GET',
    headers: buildAuthHeaders(token),
  });
  return parseJsonResponse<unknown>(response, 'Drive download file');
}

/** Deletes a file by Drive file ID. */
export async function deleteFile(fileId: string, token: string): Promise<void> {
  const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=false`, {
    method: 'DELETE',
    headers: buildAuthHeaders(token),
  });
  if (!response.ok && response.status !== 404) {
    let details = '';
    try {
      details = await response.text();
    } catch {
      details = '';
    }
    throw new Error(`Drive delete file failed (${response.status}): ${details}`.trim());
  }
}
