import './style.css';
import { countOneTabNonEmptyLines, parseOneTabExport } from './onetab_import';

type SavedTab = {
  id: string;
  url: string;
  title: string;
  savedAt: number;
};

const STORAGE_KEYS = {
  savedTabs: 'savedTabs',
} as const;

const listEl = document.querySelector<HTMLUListElement>('#list');
const emptyEl = document.querySelector<HTMLDivElement>('#empty');
const snackbarEl = document.querySelector<HTMLDivElement>('#snackbar');
const listSectionEl = document.querySelector<HTMLElement>('.list-section');
const scrollTopEl = document.querySelector<HTMLButtonElement>('#scrollTop');
const scrollBottomEl = document.querySelector<HTMLButtonElement>('#scrollBottom');
const tabCountEl = document.querySelector<HTMLSpanElement>('#tabCount');
const restoreAllEl = document.querySelector<HTMLButtonElement>('#restoreAll');
const deleteAllEl = document.querySelector<HTMLButtonElement>('#deleteAll');
const toggleIoEl = document.querySelector<HTMLButtonElement>('#toggleIo');
const exportJsonEl = document.querySelector<HTMLButtonElement>('#exportJson');
const importJsonEl = document.querySelector<HTMLButtonElement>('#importJson');
const importOneTabEl = document.querySelector<HTMLButtonElement>('#importOneTab');
const jsonAreaEl = document.querySelector<HTMLTextAreaElement>('#jsonArea');
const ioPanelEl = document.querySelector<HTMLElement>('#ioPanel');

let snackbarTimer: number | undefined;

function setStatus(message: string): void {
  if (!snackbarEl) return;
  snackbarEl.textContent = message;
  snackbarEl.classList.add('show');
  if (snackbarTimer) window.clearTimeout(snackbarTimer);
  snackbarTimer = window.setTimeout(() => {
    snackbarEl.classList.remove('show');
  }, 2200);
}

function getSavedTabs(): Promise<SavedTab[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.savedTabs], (result) => {
      resolve(Array.isArray(result.savedTabs) ? result.savedTabs : []);
    });
  });
}

function setSavedTabs(savedTabs: SavedTab[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEYS.savedTabs]: savedTabs }, () => resolve());
  });
}

function renderList(savedTabs: SavedTab[]): void {
  if (!listEl || !emptyEl) return;
  listEl.innerHTML = '';
  if (tabCountEl) tabCountEl.textContent = String(savedTabs.length);

  if (savedTabs.length === 0) {
    emptyEl.style.display = 'block';
    updateScrollControls();
    return;
  }

  emptyEl.style.display = 'none';
  for (const tab of savedTabs) {
    const item = document.createElement('li');
    item.className = 'item';

    const main = document.createElement('div');
    main.className = 'item-main';

    const title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = tab.title;

    const url = document.createElement('div');
    url.className = 'item-url';
    url.textContent = tab.url;

    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const restoreButton = document.createElement('button');
    restoreButton.className = 'icon-button row-action';
    restoreButton.setAttribute('aria-label', 'Restore');
    restoreButton.setAttribute('title', 'Restore');
    restoreButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="9" height="12" rx="2" fill="currentColor" opacity="0.6"/><rect x="13" y="11" width="6" height="2" rx="1" fill="currentColor"/><path d="M18 8l4 4-4 4z" fill="currentColor"/></svg>';
    restoreButton.addEventListener('click', () => {
      void restoreSingle(tab.id);
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'icon-button danger row-action';
    deleteButton.setAttribute('aria-label', 'Delete');
    deleteButton.setAttribute('title', 'Delete');
    deleteButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="8" width="12" height="12" rx="2" fill="currentColor"/><rect x="5" y="6" width="14" height="2" rx="1" fill="currentColor"/><rect x="9" y="4" width="6" height="2" rx="1" fill="currentColor"/></svg>';
    deleteButton.addEventListener('click', () => {
      void deleteSingle(tab.id);
    });

    main.appendChild(title);
    main.appendChild(url);
    actions.appendChild(restoreButton);
    actions.appendChild(deleteButton);
    item.appendChild(main);
    item.appendChild(actions);
    listEl.appendChild(item);
  }
  updateScrollControls();
}

async function restoreSingle(id: string): Promise<void> {
  const savedTabs = await getSavedTabs();
  const tab = savedTabs.find((entry) => entry.id === id);
  if (!tab) {
    setStatus('Tab not found.');
    return;
  }

  try {
    const reuse = await getReuseWindowContext();
    if (typeof reuse.windowId === 'number') {
      await chrome.tabs.create({ windowId: reuse.windowId, url: tab.url, active: false });
      if (typeof reuse.tabId === 'number') {
        await chrome.tabs.update(reuse.tabId, { active: true });
      }
    } else {
      await chrome.windows.create({ url: tab.url });
    }
  } catch {
    setStatus('Failed to restore tab.');
    return;
  }

  const updated = savedTabs.filter((entry) => entry.id !== id);
  await setSavedTabs(updated);
  renderList(updated);
  setStatus('Restored 1 tab.');
}

async function deleteSingle(id: string): Promise<void> {
  const savedTabs = await getSavedTabs();
  const updated = savedTabs.filter((entry) => entry.id !== id);
  if (updated.length === savedTabs.length) {
    setStatus('Tab not found.');
    return;
  }
  await setSavedTabs(updated);
  renderList(updated);
  setStatus('Deleted 1 tab.');
}

async function restoreAll(): Promise<void> {
  const savedTabs = await getSavedTabs();
  if (savedTabs.length === 0) {
    setStatus('No tabs to restore.');
    return;
  }

  const [first, ...rest] = savedTabs;
  try {
    const reuse = await getReuseWindowContext();
    if (reuse.shouldReuse && typeof reuse.tabId === 'number' && typeof reuse.windowId === 'number') {
      await chrome.tabs.create({ windowId: reuse.windowId, url: first.url, active: false });
      for (const tab of rest) {
        await chrome.tabs.create({ windowId: reuse.windowId, url: tab.url, active: false });
      }
      await chrome.tabs.update(reuse.tabId, { active: true });
    } else {
      const window = await chrome.windows.create({ url: first.url });
      const windowId = window.id;
      if (typeof windowId !== 'number') {
        throw new Error('Missing window id');
      }
      for (const tab of rest) {
        await chrome.tabs.create({ windowId, url: tab.url });
      }
    }
  } catch {
    setStatus('Failed to restore tabs.');
    return;
  }

  await setSavedTabs([]);
  renderList([]);
  setStatus('Restored all tabs.');
}

async function deleteAll(): Promise<void> {
  await setSavedTabs([]);
  renderList([]);
  setStatus('Deleted all tabs.');
}

async function getReuseWindowContext(): Promise<{
  shouldReuse: boolean;
  windowId?: number;
  tabId?: number;
}> {
  try {
    const currentTab = await chrome.tabs.getCurrent();
    if (!currentTab || typeof currentTab.windowId !== 'number' || typeof currentTab.id !== 'number') {
      return { shouldReuse: false };
    }
    const listUrl = browser.runtime.getURL('/nufftabs.html');
    const tabsInWindow = await chrome.tabs.query({ windowId: currentTab.windowId });
    const onlyListTab =
      tabsInWindow.length === 1 && tabsInWindow[0]?.url === listUrl && tabsInWindow[0]?.id === currentTab.id;
    return {
      shouldReuse: onlyListTab,
      windowId: currentTab.windowId,
      tabId: currentTab.id,
    };
  } catch {
    return { shouldReuse: false };
  }
}

function normalizeImportedTabs(data: unknown): SavedTab[] | null {
  const now = Date.now();
  const rawArray = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { savedTabs?: unknown }).savedTabs)
      ? (data as { savedTabs: unknown[] }).savedTabs
      : null;

  if (!rawArray) return null;

  const normalized: SavedTab[] = [];
  for (const entry of rawArray) {
    if (!entry || typeof entry !== 'object') return null;
    const url = (entry as { url?: unknown }).url;
    if (typeof url !== 'string' || url.length === 0) return null;

    const id = (entry as { id?: unknown }).id;
    const title = (entry as { title?: unknown }).title;
    const savedAt = (entry as { savedAt?: unknown }).savedAt;

    normalized.push({
      id: typeof id === 'string' && id.length > 0 ? id : crypto.randomUUID(),
      url,
      title: typeof title === 'string' && title.length > 0 ? title : url,
      savedAt: typeof savedAt === 'number' ? savedAt : now,
    });
  }

  return normalized;
}

async function exportJson(): Promise<void> {
  if (!jsonAreaEl) return;
  const savedTabs = await getSavedTabs();
  jsonAreaEl.value = JSON.stringify({ savedTabs }, null, 2);
  try {
    await navigator.clipboard.writeText(jsonAreaEl.value);
    setStatus('Exported and copied.');
  } catch {
    setStatus('Exported JSON.');
  }

  try {
    const blob = new Blob([jsonAreaEl.value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nufftabs-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus('Exported backup file.');
  } catch {
    // Keep existing status if download fails.
  }
}

async function importJson(): Promise<void> {
  if (!jsonAreaEl) return;
  try {
    const parsed = JSON.parse(jsonAreaEl.value);
    const normalized = normalizeImportedTabs(parsed);
    if (!normalized) {
      setStatus('Invalid JSON: expected array or { savedTabs: [] } with valid URLs.');
      return;
    }
    await setSavedTabs(normalized);
    renderList(normalized);
    setStatus('Imported JSON.');
  } catch {
    setStatus('Invalid JSON: could not parse.');
  }
}

async function importOneTab(): Promise<void> {
  if (!jsonAreaEl) return;
  const text = jsonAreaEl.value;
  const totalLines = countOneTabNonEmptyLines(text);
  const imported = parseOneTabExport(text);
  const skipped = Math.max(0, totalLines - imported.length);
  if (imported.length === 0) {
    setStatus(`Imported 0, skipped ${skipped}.`);
    return;
  }
  const existing = await getSavedTabs();
  const merged = [...existing, ...imported];
  await setSavedTabs(merged);
  renderList(merged);
  setStatus(`Imported ${imported.length}, skipped ${skipped}.`);
}

async function init(): Promise<void> {
  const refreshList = async () => {
    const savedTabs = await getSavedTabs();
    renderList(savedTabs);
  };

  await refreshList();

  restoreAllEl?.addEventListener('click', () => {
    void restoreAll();
  });

  deleteAllEl?.addEventListener('click', () => {
    void deleteAll();
  });

  toggleIoEl?.addEventListener('click', () => {
    if (!ioPanelEl) return;
    ioPanelEl.hidden = !ioPanelEl.hidden;
    updateScrollControls();
  });

  exportJsonEl?.addEventListener('click', () => {
    void exportJson();
  });

  importJsonEl?.addEventListener('click', () => {
    void importJson();
  });

  importOneTabEl?.addEventListener('click', () => {
    void importOneTab();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.savedTabs) {
      void refreshList();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      void refreshList();
    }
  });

  scrollTopEl?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  scrollBottomEl?.addEventListener('click', () => {
    const target = getListBottomScrollTarget();
    window.scrollTo({ top: target, behavior: 'smooth' });
  });

  window.addEventListener('scroll', updateScrollControls, { passive: true });
  window.addEventListener('resize', updateScrollControls);
  updateScrollControls();
}

void init();

function getListBottomScrollTarget(): number {
  if (!listSectionEl) return 0;
  const rect = listSectionEl.getBoundingClientRect();
  const listBottom = rect.bottom + window.scrollY;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const target = Math.max(0, listBottom - window.innerHeight + 16);
  return Math.min(target, maxScroll);
}

function updateScrollControls(): void {
  if (!scrollTopEl || !scrollBottomEl) return;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const hasOverflow = maxScroll > 8;
  const nearTop = window.scrollY < 24;
  const bottomTarget = getListBottomScrollTarget();
  const nearBottom = window.scrollY >= bottomTarget - 24;

  scrollTopEl.classList.toggle('is-hidden', !hasOverflow);
  scrollBottomEl.classList.toggle('is-hidden', !hasOverflow);
  scrollTopEl.classList.toggle('is-disabled', !hasOverflow || nearTop);
  scrollBottomEl.classList.toggle('is-disabled', !hasOverflow || nearBottom);
}
