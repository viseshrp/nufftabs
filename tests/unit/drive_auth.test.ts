import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getAuthToken,
  getAuthTokenSilently,
  isIdentityApiAvailable,
  removeCachedAuthToken,
  revokeToken,
} from '../../entrypoints/drive/auth';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

describe('drive auth helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects identity API availability', () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    expect(isIdentityApiAvailable()).toBe(true);
  });

  it('throws when identity API is unavailable', async () => {
    Object.defineProperty(globalThis, 'chrome', {
      value: {
        runtime: {},
      },
      configurable: true,
      writable: true,
    });

    await expect(getAuthToken(true)).rejects.toThrow('Google Drive auth is unavailable');
  });

  it('gets token and silent token from cached identity state', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await expect(getAuthToken(true)).resolves.toBe('mock-auth-token');
    await expect(getAuthTokenSilently()).resolves.toBe('mock-auth-token');
  });

  it('returns null for silent lookup failures', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      mock.chrome.runtime.lastError = { message: 'missing token' };
      callback(undefined);
    };

    await expect(getAuthTokenSilently()).resolves.toBeNull();
  });

  it('supports token object responses and rejects empty token results', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback({ token: 'object-token' } as unknown as string);
    };
    await expect(getAuthToken(true)).resolves.toBe('object-token');

    mock.chrome.identity.getAuthToken = (_details, callback) => {
      delete mock.chrome.runtime.lastError;
      callback(undefined);
    };
    await expect(getAuthToken(true)).rejects.toThrow('No auth token returned');
  });

  it('clears cached token and revokes via network call', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await removeCachedAuthToken('mock-auth-token');
    await revokeToken('mock-auth-token');

    await expect(getAuthTokenSilently()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://accounts.google.com/o/oauth2/revoke');
    expect(init.method).toBe('POST');
  });

  it('ignores revoke fetch failures', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(revokeToken('mock-auth-token')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
