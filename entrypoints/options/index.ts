import './style.css';
import { readSettings, writeSettings, type Settings } from '../shared/storage';

const excludePinnedEl = document.querySelector<HTMLInputElement>('#excludePinned');
const restoreBatchSizeEl = document.querySelector<HTMLInputElement>('#restoreBatchSize');
const statusEl = document.querySelector<HTMLDivElement>('#status');

function setStatus(message: string): void {
  if (statusEl) statusEl.textContent = message;
}

async function init(): Promise<void> {
  if (!excludePinnedEl || !restoreBatchSizeEl) return;
  let settings: Settings = await readSettings();
  excludePinnedEl.checked = settings.excludePinned;
  restoreBatchSizeEl.value = String(settings.restoreBatchSize);

  const saveSettings = async (nextSettings: Settings) => {
    const saved = await writeSettings(nextSettings);
    if (!saved) {
      excludePinnedEl.checked = settings.excludePinned;
      restoreBatchSizeEl.value = String(settings.restoreBatchSize);
      setStatus('Failed to save settings.');
      return;
    }
    settings = nextSettings;
    setStatus('Settings saved.');
  };

  const getBatchSizeInput = (): number | null => {
    const raw = Number(restoreBatchSizeEl.value);
    if (!Number.isFinite(raw)) return null;
    const parsed = Math.floor(raw);
    return parsed > 0 ? parsed : null;
  };

  excludePinnedEl.addEventListener('change', async () => {
    const nextSettings: Settings = {
      excludePinned: excludePinnedEl.checked,
      restoreBatchSize: settings.restoreBatchSize,
    };
    await saveSettings(nextSettings);
  });

  const handleBatchSizeChange = async () => {
    const parsed = getBatchSizeInput();
    if (!parsed) {
      restoreBatchSizeEl.value = String(settings.restoreBatchSize);
      setStatus('Enter a value of 1 or higher.');
      return;
    }
    const nextSettings: Settings = {
      excludePinned: excludePinnedEl.checked,
      restoreBatchSize: parsed,
    };
    await saveSettings(nextSettings);
  };

  restoreBatchSizeEl.addEventListener('change', () => {
    void handleBatchSizeChange();
  });

  restoreBatchSizeEl.addEventListener('blur', () => {
    void handleBatchSizeChange();
  });
}

void init();
