// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module
const mockAuthenticate = vi.fn();
const mockGetProfileUserInfo = vi.fn();
const mockClearCachedToken = vi.fn();

vi.mock('../../entrypoints/shared/google_drive', () => ({
  authenticate: mockAuthenticate,
  getProfileUserInfo: mockGetProfileUserInfo,
  clearCachedToken: mockClearCachedToken,
  findFile: vi.fn(),
  uploadFile: vi.fn(),
}));

describe('auth page integration', () => {
  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Set up DOM elements required by auth/index.ts
    document.body.innerHTML = `
      <div id="status"></div>
      <div id="userInfo" hidden>
        <img id="userAvatar" />
        <span id="userName"></span>
      </div>
      <button id="connectBtn" hidden></button>
      <button id="disconnectBtn" hidden></button>
      <div id="error"></div>
    `;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('initializes in disconnected state when no token is present', async () => {
    mockAuthenticate.mockRejectedValue(new Error('No token')); // authenticate(false) fails

    // Import to trigger init()
    await import('../../entrypoints/auth/index');

    // Wait for async init
    await new Promise(resolve => setTimeout(resolve, 0));

    const statusEl = document.getElementById('status');
    const connectBtn = document.getElementById('connectBtn');

    expect(mockAuthenticate).toHaveBeenCalledWith(false);
    expect(statusEl?.textContent).toBe('Not connected');
    expect(connectBtn?.hidden).toBe(false);
  });

  it('initializes in connected state when token exists', async () => {
    mockAuthenticate.mockResolvedValue('valid-token');
    mockGetProfileUserInfo.mockResolvedValue({
        email: 'test@example.com',
        name: 'Test User',
        picture: 'pic.jpg'
    });

    // Reset modules to re-run top-level code
    vi.resetModules();
    await import('../../entrypoints/auth/index');
    await new Promise(resolve => setTimeout(resolve, 0));

    const statusEl = document.getElementById('status');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const userNameEl = document.getElementById('userName');

    expect(statusEl?.textContent).toBe('Connected as test@example.com');
    expect(disconnectBtn?.hidden).toBe(false);
    expect(userNameEl?.textContent).toBe('Test User');
  });

  it('handles connect button click', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('No token')); // Init fails

    vi.resetModules();
    await import('../../entrypoints/auth/index');
    await new Promise(resolve => setTimeout(resolve, 0));

    const connectBtn = document.getElementById('connectBtn');
    if (!connectBtn) throw new Error('Connect button not found');

    // Setup success for click
    mockAuthenticate.mockResolvedValue('new-token');
    mockGetProfileUserInfo.mockResolvedValue({ email: 'new@example.com', name: 'New User', picture: '' });

    connectBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockAuthenticate).toHaveBeenCalledWith(true); // Interactive auth
    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Connected as new@example.com');
  });

  it('handles connect failure', async () => {
    mockAuthenticate.mockRejectedValueOnce(new Error('No token')); // Init fails

    vi.resetModules();
    await import('../../entrypoints/auth/index');
    await new Promise(resolve => setTimeout(resolve, 0));

    const connectBtn = document.getElementById('connectBtn');
    if (!connectBtn) throw new Error('Connect button not found');

    // Setup failure for click
    mockAuthenticate.mockRejectedValue(new Error('User cancelled'));

    connectBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const errorEl = document.getElementById('error');
    expect(errorEl?.textContent).toContain('Authentication failed');
  });

  it('handles disconnect button click', async () => {
    mockAuthenticate.mockResolvedValue('token-to-revoke'); // Init success
    mockGetProfileUserInfo.mockResolvedValue({ email: 'user@example.com' });

    vi.resetModules();
    await import('../../entrypoints/auth/index');
    await new Promise(resolve => setTimeout(resolve, 0));

    const disconnectBtn = document.getElementById('disconnectBtn');
    if (!disconnectBtn) throw new Error('Disconnect button not found');

    // Setup for disconnect
    mockAuthenticate.mockResolvedValue('token-to-revoke'); // Called again to get token for revocation
    mockClearCachedToken.mockResolvedValue(undefined);

    disconnectBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockClearCachedToken).toHaveBeenCalledWith('token-to-revoke');
    const statusEl = document.getElementById('status');
    expect(statusEl?.textContent).toBe('Not connected');
  });
});
