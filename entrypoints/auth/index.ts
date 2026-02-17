import { authenticate, getProfileUserInfo, clearCachedToken } from '../shared/google_drive';
import { logExtensionError } from '../shared/utils';

const statusEl = document.getElementById('status');
const userInfoEl = document.getElementById('userInfo');
const userAvatarEl = document.getElementById('userAvatar') as HTMLImageElement;
const userNameEl = document.getElementById('userName');
const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const errorEl = document.getElementById('error');

async function updateUI(token: string | null) {
  if (!statusEl || !userInfoEl || !connectBtn || !disconnectBtn || !errorEl) return;

  errorEl.textContent = '';

  if (!token) {
    statusEl.textContent = 'Not connected';
    userInfoEl.hidden = true;
    connectBtn.hidden = false;
    disconnectBtn.hidden = true;
    return;
  }

  statusEl.textContent = 'Connected';
  connectBtn.hidden = true;
  disconnectBtn.hidden = false;
  userInfoEl.hidden = false;

  try {
    const info = await getProfileUserInfo(token);
    if (userAvatarEl) userAvatarEl.src = info.picture;
    if (userNameEl) userNameEl.textContent = info.name || info.email;
    statusEl.textContent = `Connected as ${info.email}`;
  } catch (error) {
    logExtensionError('Failed to fetch user info', error);
    statusEl.textContent = 'Connected (failed to load profile)';
  }
}

async function handleConnect() {
  if (!errorEl) return;
  try {
    errorEl.textContent = '';
    const token = await authenticate(true);
    await updateUI(token);
  } catch (error) {
    logExtensionError('Auth failed', error);
    errorEl.textContent = 'Authentication failed. Please try again.';
  }
}

async function handleDisconnect() {
  try {
    if (errorEl) errorEl.textContent = '';
    // Get current token without interaction to clear it
    const token = await authenticate(false).catch(() => null);
    if (token) {
      await clearCachedToken(token);
    }
    await updateUI(null);
  } catch (error) {
    logExtensionError('Disconnect failed', error);
    await updateUI(null);
  }
}

async function init() {
  connectBtn?.addEventListener('click', handleConnect);
  disconnectBtn?.addEventListener('click', handleDisconnect);

  try {
    const token = await authenticate(false).catch(() => null);
    await updateUI(token);
  } catch (error) {
    await updateUI(null);
  }
}

init();
