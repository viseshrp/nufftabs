import './style.css';
import { readSettings, writeSettings, type Settings } from '../shared/storage';

const excludePinnedEl = document.querySelector<HTMLInputElement>('#excludePinned');
const statusEl = document.querySelector<HTMLDivElement>('#status');

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

async function init(): Promise<void> {
  if (!excludePinnedEl) return;
  let settings: Settings = await readSettings();
  excludePinnedEl.checked = settings.excludePinned;
  excludePinnedEl.addEventListener('change', async () => {
    const nextSettings: Settings = { excludePinned: excludePinnedEl.checked };
    const saved = await writeSettings(nextSettings);
    if (!saved) {
      excludePinnedEl.checked = settings.excludePinned;
      setStatus('Failed to save settings.');
      return;
    }
    settings = nextSettings;
    setStatus('Settings saved.');
  });
}

void init();
