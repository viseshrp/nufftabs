// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authenticate, getProfileUserInfo, uploadFile, findFile } from '../../entrypoints/shared/google_drive';

describe('google_drive', () => {
  const mockGetAuthToken = vi.fn();
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockGetAuthToken.mockReset();
    mockFetch.mockReset();
    vi.stubGlobal('chrome', {
      identity: {
        getAuthToken: mockGetAuthToken,
      },
      runtime: {
        lastError: undefined,
      },
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('authenticate', () => {
    it('should resolve with token when successful', async () => {
      mockGetAuthToken.mockImplementation((options, callback) => {
        callback('mock-token');
      });

      const token = await authenticate(true);
      expect(token).toBe('mock-token');
      expect(mockGetAuthToken).toHaveBeenCalledWith({ interactive: true }, expect.any(Function));
    });

    it('should reject when chrome.runtime.lastError is set', async () => {
      mockGetAuthToken.mockImplementation((options, callback) => {
        globalThis.chrome.runtime.lastError = { message: 'Auth failed' };
        callback(undefined);
      });

      await expect(authenticate(false)).rejects.toEqual({ message: 'Auth failed' });
    });
  });

  describe('getProfileUserInfo', () => {
    it('should return user info when fetch succeeds', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ email: 'test@example.com', name: 'Test User', picture: 'pic.jpg' }),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const info = await getProfileUserInfo('token');
      expect(info).toEqual({ email: 'test@example.com', name: 'Test User', picture: 'pic.jpg' });
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('userinfo'), {
        headers: { Authorization: 'Bearer token' },
      });
    });

    it('should throw error when fetch fails', async () => {
        const mockResponse = {
            ok: false,
            statusText: 'Unauthorized',
        };
        mockFetch.mockResolvedValue(mockResponse);

        await expect(getProfileUserInfo('token')).rejects.toThrow('Failed to fetch user info: Unauthorized');
    });
  });

  describe('findFile', () => {
      it('should return file ID if file exists', async () => {
          const mockResponse = {
              ok: true,
              json: async () => ({ files: [{ id: 'file-123', name: 'backup.json' }] }),
          };
          mockFetch.mockResolvedValue(mockResponse);

          const fileId = await findFile('token', 'backup.json');
          expect(fileId).toBe('file-123');
      });

      it('should return null if file does not exist', async () => {
          const mockResponse = {
              ok: true,
              json: async () => ({ files: [] }),
          };
          mockFetch.mockResolvedValue(mockResponse);

          const fileId = await findFile('token', 'backup.json');
          expect(fileId).toBeNull();
      });

      it('should escape quotes in filename', async () => {
          const mockResponse = {
              ok: true,
              json: async () => ({ files: [] }),
          };
          mockFetch.mockResolvedValue(mockResponse);

          await findFile('token', "User's Backup.json");

          expect(mockFetch).toHaveBeenCalledWith(
              expect.stringContaining(encodeURIComponent("name = 'User\\'s Backup.json'")),
              expect.any(Object)
          );
      });
  });

  describe('uploadFile', () => {
    it('should create new file if mode is new', async () => {
        const mockResponse = {
            ok: true,
            text: async () => '{"id": "new-file-id"}',
        };
        mockFetch.mockResolvedValue(mockResponse);

        await uploadFile('token', '{}', 'backup.json', 'new');

        expect(mockFetch).toHaveBeenCalledWith(
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    Authorization: 'Bearer token',
                }),
            })
        );
    });

    it('should update existing file if mode is overwrite and file exists', async () => {
        // Mock findFile response (first call to fetch)
        const mockFindResponse = {
            ok: true,
            json: async () => ({ files: [{ id: 'existing-id' }] }),
        };
        // Mock upload response (second call to fetch)
        const mockUploadResponse = {
            ok: true,
            text: async () => '{"id": "existing-id"}',
        };

        mockFetch
            .mockResolvedValueOnce(mockFindResponse)
            .mockResolvedValueOnce(mockUploadResponse);

        await uploadFile('token', '{}', 'backup.json', 'overwrite');

        expect(mockFetch).toHaveBeenCalledTimes(2);
        // First call: search
        expect(mockFetch).toHaveBeenNthCalledWith(1, expect.stringContaining('q=name'), expect.any(Object));
        // Second call: patch
        expect(mockFetch).toHaveBeenNthCalledWith(2,
            'https://www.googleapis.com/upload/drive/v3/files/existing-id?uploadType=multipart',
            expect.objectContaining({
                method: 'PATCH',
            })
        );
    });

    it('should create new file if mode is overwrite but file not found', async () => {
         // Mock findFile response (not found)
         const mockFindResponse = {
            ok: true,
            json: async () => ({ files: [] }),
        };
        // Mock upload response
        const mockUploadResponse = {
            ok: true,
            text: async () => '{"id": "new-id"}',
        };

        mockFetch
            .mockResolvedValueOnce(mockFindResponse)
            .mockResolvedValueOnce(mockUploadResponse);

        await uploadFile('token', '{}', 'backup.json', 'overwrite');

        expect(mockFetch).toHaveBeenCalledTimes(2);
         // Second call: POST (create) because fileId was null
         expect(mockFetch).toHaveBeenNthCalledWith(2,
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
            expect.objectContaining({
                method: 'POST',
            })
        );
    });
  });
});
