import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteFile, downloadJsonFile, getOrCreateFolder, listFiles, uploadJsonFile } from '../../entrypoints/drive/drive_api';

describe('drive_api', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists files from a folder', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ files: [{ id: 'f1', name: 'backup-a.json' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const files = await listFiles('folder-1', 'token-1');

    expect(files).toEqual([{ id: 'f1', name: 'backup-a.json' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/drive/v3/files?');
    expect(url).toContain('orderBy=name+desc');
    expect(init.method).toBe('GET');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer token-1');
  });

  it('paginates through all file pages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('pageToken=token-2')) {
        return new Response(JSON.stringify({ files: [{ id: 'f3', name: 'backup-c.json' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          files: [
            { id: 'f1', name: 'backup-a.json' },
            { id: 'f2', name: 'backup-b.json' },
          ],
          nextPageToken: 'token-2',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const files = await listFiles('folder-1', 'token-1');

    expect(files).toEqual([
      { id: 'f1', name: 'backup-a.json' },
      { id: 'f2', name: 'backup-b.json' },
      { id: 'f3', name: 'backup-c.json' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [secondUrl] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(firstUrl).toContain('fields=nextPageToken%2Cfiles');
    expect(secondUrl).toContain('pageToken=token-2');
  });

  it('returns existing folder id before attempting create', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ files: [{ id: 'existing-folder' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const folderId = await getOrCreateFolder('nufftabs_backups', 'token-1');

    expect(folderId).toBe('existing-folder');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates a folder when listing returns no matches', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ id: 'created-folder' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const folderId = await getOrCreateFolder('install-id', 'token-1', 'root-folder');

    expect(folderId).toBe('created-folder');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, createInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(createInit.method).toBe('POST');
    expect(typeof createInit.body).toBe('string');
    expect(String(createInit.body)).toContain('"install-id"');
    expect(String(createInit.body)).toContain('"root-folder"');
  });

  it('uploads JSON content as multipart body', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'file-1', name: 'backup.json', size: '123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadJsonFile('backup.json', '{"x":1}', 'folder-1', 'token-1');

    expect(result.id).toBe('file-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('Content-Type')).toContain('multipart/related; boundary=');
    expect(String(init.body)).toContain('backup.json');
    expect(String(init.body)).toContain('{"x":1}');
  });

  it('downloads JSON content by file id', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ hello: 'world' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const payload = await downloadJsonFile('file-1', 'token-1');

    expect(payload).toEqual({ hello: 'world' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/files/file-1?alt=media');
  });

  it('deletes file and ignores 404 responses', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteFile('missing-file', 'token-1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws helpful error text for failed API responses', async () => {
    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(listFiles('folder-1', 'token-1')).rejects.toThrow('Drive list files failed (403)');
  });

  it('handles list failure when response text cannot be read', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: false,
        status: 401,
        text: async () => {
          throw new Error('boom');
        },
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listFiles('folder-1', 'token')).rejects.toThrow('Drive list files failed (401)');
  });

  it('throws when folder create response has no id', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getOrCreateFolder('folder', 'token')).rejects.toThrow('returned no folder ID');
  });

  it('throws when upload response is missing required metadata', async () => {
    const fetchNoId = vi.fn(async () =>
      new Response(JSON.stringify({ name: 'backup.json' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchNoId);
    await expect(uploadJsonFile('backup.json', '{}', 'folder', 'token')).rejects.toThrow('no file ID');

    const fetchNoName = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'f1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchNoName);
    await expect(uploadJsonFile('backup.json', '{}', 'folder', 'token')).rejects.toThrow('no file name');
  });

  it('handles delete-file failures even when response body read fails', async () => {
    const fetchMock = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => {
          throw new Error('cannot read body');
        },
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteFile('f1', 'token')).rejects.toThrow('Drive delete file failed (500)');
  });
});
