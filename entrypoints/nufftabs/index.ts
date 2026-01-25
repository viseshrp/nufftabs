import './style.css';
import { countOneTabNonEmptyLines, parseOneTabExport } from './onetab_import';
import {
  createSavedTab,
  LIST_PAGE_PATH,
  normalizeSavedGroups,
  readSavedGroups,
  readSettings,
  UNKNOWN_GROUP_KEY,
  writeSavedGroups,
  type SavedTab,
  type SavedTabGroups,
} from '../shared/storage';

const groupsEl = document.querySelector<HTMLDivElement>('#groups');
const emptyEl = document.querySelector<HTMLDivElement>('#empty');
const snackbarEl = document.querySelector<HTMLDivElement>('#snackbar');
const listSectionEl = document.querySelector<HTMLElement>('.list-section');
const scrollTopEl = document.querySelector<HTMLButtonElement>('#scrollTop');
const scrollBottomEl = document.querySelector<HTMLButtonElement>('#scrollBottom');
const tabCountEl = document.querySelector<HTMLSpanElement>('#tabCount');
const toggleIoEl = document.querySelector<HTMLButtonElement>('#toggleIo');
const exportJsonEl = document.querySelector<HTMLButtonElement>('#exportJson');
const importJsonEl = document.querySelector<HTMLButtonElement>('#importJson');
const importJsonReplaceEl = document.querySelector<HTMLButtonElement>('#importJsonReplace');
const importFileEl = document.querySelector<HTMLButtonElement>('#importFile');
const importFileInputEl = document.querySelector<HTMLInputElement>('#importFileInput');
const importOneTabEl = document.querySelector<HTMLButtonElement>('#importOneTab');
const clearJsonEl = document.querySelector<HTMLButtonElement>('#clearJson');
const jsonAreaEl = document.querySelector<HTMLTextAreaElement>('#jsonArea');
const ioPanelEl = document.querySelector<HTMLElement>('#ioPanel');

const SVG_NS = 'http://www.w3.org/2000/svg';

let snackbarTimer: number | undefined;
let currentGroups: SavedTabGroups = {};

type SvgElementSpec = {
  tag: 'path' | 'rect';
  attrs: Record<string, string>;
};

function createSvgIcon(elements: SvgElementSpec[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const { tag, attrs } of elements) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value);
    }
    svg.appendChild(el);
  }
  return svg;
}

function cloneGroups(groups: SavedTabGroups): SavedTabGroups {
  const cloned: SavedTabGroups = {};
  for (const [key, tabs] of Object.entries(groups)) {
    cloned[key] = tabs.slice();
  }
  return cloned;
}

function countTotalTabs(groups: SavedTabGroups): number {
  return Object.values(groups).reduce((sum, tabs) => sum + tabs.length, 0);
}

function setStatus(message: string): void {
  if (!snackbarEl) return;
  snackbarEl.textContent = message;
  snackbarEl.classList.add('show');
  if (snackbarTimer) window.clearTimeout(snackbarTimer);
  snackbarTimer = window.setTimeout(() => {
    snackbarEl.classList.remove('show');
  }, 2200);
}

function renderGroups(savedGroups: SavedTabGroups): void {
  if (!groupsEl || !emptyEl) return;
  const entries = Object.entries(savedGroups).filter(([, tabs]) => tabs.length > 0);
  const totalCount = entries.reduce((sum, [, tabs]) => sum + tabs.length, 0);
  if (tabCountEl) tabCountEl.textContent = String(totalCount);

  if (totalCount === 0) {
    emptyEl.style.display = 'block';
    groupsEl.replaceChildren();
    updateScrollControls();
    return;
  }

  emptyEl.style.display = 'none';
  const fragment = document.createDocumentFragment();

  for (const [groupKey, tabs] of entries) {
    const card = document.createElement('section');
    card.className = 'group-card';

    const header = document.createElement('div');
    header.className = 'group-header';

    const metaWrap = document.createElement('div');

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;

    const createdAt = tabs.reduce((min, tab) => {
      const value = typeof tab.savedAt === 'number' ? tab.savedAt : Number.POSITIVE_INFINITY;
      return value < min ? value : min;
    }, Number.POSITIVE_INFINITY);
    const createdLabel = Number.isFinite(createdAt)
      ? `Created ${formatCreatedAt(createdAt)}`
      : 'Created -';

    const meta = document.createElement('div');
    meta.className = 'group-meta';
    meta.textContent = createdLabel;

    metaWrap.appendChild(title);
    metaWrap.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'group-actions';

    const collapseButton = document.createElement('button');
    collapseButton.className = 'icon-button collapse-toggle';
    collapseButton.setAttribute('aria-label', 'Collapse list');
    collapseButton.setAttribute('title', 'Collapse list');
    collapseButton.appendChild(
      createSvgIcon([
        {
          tag: 'path',
          attrs: {
            d: 'M6 9l6 6 6-6z',
            fill: 'currentColor',
          },
        },
      ]),
    );

    const restoreAllButton = document.createElement('button');
    restoreAllButton.className = 'icon-button';
    restoreAllButton.setAttribute('aria-label', 'Restore all tabs');
    restoreAllButton.setAttribute('title', 'Restore all');
    restoreAllButton.appendChild(
      createSvgIcon([
        {
          tag: 'rect',
          attrs: {
            x: '4',
            y: '7',
            width: '9',
            height: '8',
            rx: '2',
            fill: 'currentColor',
            opacity: '0.45',
          },
        },
        {
          tag: 'rect',
          attrs: {
            x: '7',
            y: '5',
            width: '9',
            height: '8',
            rx: '2',
            fill: 'currentColor',
            opacity: '0.7',
          },
        },
        {
          tag: 'rect',
          attrs: {
            x: '13',
            y: '11',
            width: '6',
            height: '2',
            rx: '1',
            fill: 'currentColor',
          },
        },
        {
          tag: 'path',
          attrs: {
            d: 'M18 8l4 4-4 4z',
            fill: 'currentColor',
          },
        },
      ]),
    );
    restoreAllButton.addEventListener('click', () => {
      void restoreGroup(groupKey);
    });

    const deleteAllButton = document.createElement('button');
    deleteAllButton.className = 'icon-button danger';
    deleteAllButton.setAttribute('aria-label', 'Delete all tabs');
    deleteAllButton.setAttribute('title', 'Delete all');
    deleteAllButton.appendChild(
      createSvgIcon([
        {
          tag: 'rect',
          attrs: {
            x: '6',
            y: '8',
            width: '12',
            height: '12',
            rx: '2',
            fill: 'currentColor',
          },
        },
        {
          tag: 'rect',
          attrs: {
            x: '5',
            y: '6',
            width: '14',
            height: '2',
            rx: '1',
            fill: 'currentColor',
          },
        },
        {
          tag: 'rect',
          attrs: {
            x: '9',
            y: '4',
            width: '6',
            height: '2',
            rx: '1',
            fill: 'currentColor',
          },
        },
      ]),
    );
    deleteAllButton.addEventListener('click', () => {
      void deleteGroup(groupKey);
    });

    collapseButton.addEventListener('click', () => {
      const isCollapsed = card.classList.toggle('is-collapsed');
      const label = isCollapsed ? 'Expand list' : 'Collapse list';
      collapseButton.setAttribute('aria-label', label);
      collapseButton.setAttribute('title', label);
      updateScrollControls();
    });

    actions.appendChild(collapseButton);
    actions.appendChild(restoreAllButton);
    actions.appendChild(deleteAllButton);

    header.appendChild(metaWrap);
    header.appendChild(actions);

    const itemsWrap = document.createElement('div');
    itemsWrap.className = 'group-items';

    const list = document.createElement('ul');
    list.className = 'list';

    for (const tab of tabs) {
      const item = document.createElement('li');
      item.className = 'item';

      const main = document.createElement('div');
      main.className = 'item-main';

      const tabTitle = document.createElement('div');
      tabTitle.className = 'item-title';
      tabTitle.textContent = tab.title;

      const url = document.createElement('div');
      url.className = 'item-url';
      url.textContent = tab.url;

      const rowActions = document.createElement('div');
      rowActions.className = 'row-actions';

      const restoreButton = document.createElement('button');
      restoreButton.className = 'icon-button row-action';
      restoreButton.setAttribute('aria-label', 'Restore');
      restoreButton.setAttribute('title', 'Restore');
      restoreButton.appendChild(
        createSvgIcon([
          {
            tag: 'rect',
            attrs: {
              x: '4',
              y: '6',
              width: '9',
              height: '12',
              rx: '2',
              fill: 'currentColor',
              opacity: '0.6',
            },
          },
          {
            tag: 'rect',
            attrs: {
              x: '13',
              y: '11',
              width: '6',
              height: '2',
              rx: '1',
              fill: 'currentColor',
            },
          },
          {
            tag: 'path',
            attrs: {
              d: 'M18 8l4 4-4 4z',
              fill: 'currentColor',
            },
          },
        ]),
      );
      restoreButton.addEventListener('click', () => {
        void restoreSingle(groupKey, tab.id);
      });

      const deleteButton = document.createElement('button');
      deleteButton.className = 'icon-button danger row-action';
      deleteButton.setAttribute('aria-label', 'Delete');
      deleteButton.setAttribute('title', 'Delete');
      deleteButton.appendChild(
        createSvgIcon([
          {
            tag: 'rect',
            attrs: {
              x: '6',
              y: '8',
              width: '12',
              height: '12',
              rx: '2',
              fill: 'currentColor',
            },
          },
          {
            tag: 'rect',
            attrs: {
              x: '5',
              y: '6',
              width: '14',
              height: '2',
              rx: '1',
              fill: 'currentColor',
            },
          },
          {
            tag: 'rect',
            attrs: {
              x: '9',
              y: '4',
              width: '6',
              height: '2',
              rx: '1',
              fill: 'currentColor',
            },
          },
        ]),
      );
      deleteButton.addEventListener('click', () => {
        void deleteSingle(groupKey, tab.id);
      });

      main.appendChild(tabTitle);
      main.appendChild(url);
      rowActions.appendChild(restoreButton);
      rowActions.appendChild(deleteButton);
      item.appendChild(main);
      item.appendChild(rowActions);
      list.appendChild(item);
    }

    itemsWrap.appendChild(list);
    card.appendChild(header);
    card.appendChild(itemsWrap);
    fragment.appendChild(card);
  }

  groupsEl.replaceChildren(fragment);
  updateScrollControls();
}

function applyGroups(savedGroups: SavedTabGroups): void {
  currentGroups = savedGroups;
  renderGroups(savedGroups);
}

async function refreshList(nextGroups?: SavedTabGroups): Promise<void> {
  const savedGroups = nextGroups ?? (await readSavedGroups());
  applyGroups(savedGroups);
}

async function restoreSingle(groupKey: string, id: string): Promise<void> {
  const savedGroups = cloneGroups(currentGroups);
  const groupTabs = savedGroups[groupKey] ?? [];
  const tab = groupTabs.find((entry) => entry.id === id);
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

  const updatedGroup = groupTabs.filter((entry) => entry.id !== id);
  if (updatedGroup.length > 0) {
    savedGroups[groupKey] = updatedGroup;
  } else {
    delete savedGroups[groupKey];
  }
  const saved = await writeSavedGroups(savedGroups);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  applyGroups(savedGroups);
  setStatus('Restored 1 tab.');
}

async function deleteSingle(groupKey: string, id: string): Promise<void> {
  const savedGroups = cloneGroups(currentGroups);
  const groupTabs = savedGroups[groupKey] ?? [];
  const updatedGroup = groupTabs.filter((entry) => entry.id !== id);
  if (updatedGroup.length === groupTabs.length) {
    setStatus('Tab not found.');
    return;
  }
  if (updatedGroup.length > 0) {
    savedGroups[groupKey] = updatedGroup;
  } else {
    delete savedGroups[groupKey];
  }
  const saved = await writeSavedGroups(savedGroups);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  applyGroups(savedGroups);
  setStatus('Deleted 1 tab.');
}

async function restoreGroup(groupKey: string): Promise<void> {
  const savedGroups = cloneGroups(currentGroups);
  const groupTabs = savedGroups[groupKey] ?? [];
  if (groupTabs.length === 0) {
    setStatus('No tabs to restore.');
    return;
  }

  const restored = await restoreTabs(groupTabs);
  if (!restored) return;

  delete savedGroups[groupKey];
  const saved = await writeSavedGroups(savedGroups);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  applyGroups(savedGroups);
  setStatus('Restored all tabs.');
}

async function deleteGroup(groupKey: string): Promise<void> {
  const savedGroups = cloneGroups(currentGroups);
  const groupTabs = savedGroups[groupKey] ?? [];
  if (groupTabs.length === 0) {
    setStatus('No tabs to delete.');
    return;
  }
  delete savedGroups[groupKey];
  const saved = await writeSavedGroups(savedGroups);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  applyGroups(savedGroups);
  setStatus('Deleted tabs.');
}

async function restoreTabs(savedTabs: SavedTab[]): Promise<boolean> {
  const settings = await readSettings();
  const chunkSize = settings.restoreBatchSize > 0 ? settings.restoreBatchSize : 100;
  const chunks: SavedTab[][] = [];
  for (let i = 0; i < savedTabs.length; i += chunkSize) {
    chunks.push(savedTabs.slice(i, i + chunkSize));
  }
  try {
    const reuse = await getReuseWindowContext();
    if (reuse.shouldReuse && typeof reuse.tabId === 'number' && typeof reuse.windowId === 'number') {
      const [firstChunk, ...remainingChunks] = chunks;
      if (firstChunk) {
        for (const tab of firstChunk) {
          await chrome.tabs.create({ windowId: reuse.windowId, url: tab.url, active: false });
        }
      }
      await chrome.tabs.update(reuse.tabId, { active: true });
      for (const chunk of remainingChunks) {
        const [first, ...rest] = chunk;
        if (!first) continue;
        const window = await chrome.windows.create({ url: first.url });
        const windowId = window.id;
        if (typeof windowId !== 'number') {
          throw new Error('Missing window id');
        }
        for (const tab of rest) {
          await chrome.tabs.create({ windowId, url: tab.url });
        }
      }
    } else {
      for (const chunk of chunks) {
        const [first, ...rest] = chunk;
        if (!first) continue;
        const window = await chrome.windows.create({ url: first.url });
        const windowId = window.id;
        if (typeof windowId !== 'number') {
          throw new Error('Missing window id');
        }
        for (const tab of rest) {
          await chrome.tabs.create({ windowId, url: tab.url });
        }
      }
    }
  } catch {
    setStatus('Failed to restore tabs.');
    return false;
  }

  return true;
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
    const listUrl = chrome.runtime.getURL(LIST_PAGE_PATH);
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

function normalizeTabArray(data: unknown): SavedTab[] | null {
  if (!Array.isArray(data)) return null;

  const now = Date.now();
  const normalized: SavedTab[] = [];
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') return null;
    const url = (entry as { url?: unknown }).url;
    if (typeof url !== 'string' || url.length === 0) return null;

    const id = (entry as { id?: unknown }).id;
    const title = (entry as { title?: unknown }).title;
    const savedAt = (entry as { savedAt?: unknown }).savedAt;

    normalized.push(
      createSavedTab({
        url,
        id: typeof id === 'string' && id.length > 0 ? id : undefined,
        title: typeof title === 'string' && title.length > 0 ? title : undefined,
        savedAt: typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : now,
      }),
    );
  }

  return normalized;
}

function normalizeImportedGroups(data: unknown, fallbackKey: string): SavedTabGroups | null {
  const payload = Array.isArray(data)
    ? data
    : data && typeof data === 'object'
      ? (data as { savedTabs?: unknown }).savedTabs ?? data
      : null;

  if (!payload) return null;

  if (Array.isArray(payload)) {
    const normalized = normalizeTabArray(payload);
    if (!normalized) return null;
    return normalized.length > 0 ? { [fallbackKey]: normalized } : {};
  }

  if (payload && typeof payload === 'object') {
    const groups: SavedTabGroups = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const normalized = normalizeTabArray(value);
      if (!normalized) return null;
      if (normalized.length > 0) groups[key] = normalized;
    }
    return groups;
  }

  return null;
}

function mergeGroups(existing: SavedTabGroups, incoming: SavedTabGroups): SavedTabGroups {
  const merged = cloneGroups(existing);
  for (const [groupKey, tabs] of Object.entries(incoming)) {
    if (tabs.length === 0) continue;
    const existingTabs = merged[groupKey];
    merged[groupKey] = existingTabs ? [...existingTabs, ...tabs] : tabs.slice();
  }
  return merged;
}

async function exportJson(): Promise<void> {
  if (!jsonAreaEl) return;
  const savedGroups = currentGroups;
  const total = countTotalTabs(savedGroups);
  jsonAreaEl.value = JSON.stringify({ savedTabs: savedGroups }, null, 2);

  let copied = false;
  try {
    await navigator.clipboard.writeText(jsonAreaEl.value);
    copied = true;
  } catch {
    // Ignore; we'll report status below.
  }

  let downloaded = false;
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
    downloaded = true;
  } catch {
    // Keep existing status if download fails.
  }

  const extras = [copied ? 'copied' : null, downloaded ? 'downloaded' : null].filter(Boolean).join(', ');
  setStatus(`Exported ${total} tab${total === 1 ? '' : 's'}${extras ? ` (${extras})` : ''}.`);
}

async function importJsonText(text: string, mode: 'append' | 'replace'): Promise<void> {
  try {
    const parsed = JSON.parse(text);
    const fallbackKey = await getCurrentWindowKey();
    const normalized = normalizeImportedGroups(parsed, fallbackKey);
    if (!normalized) {
      setStatus('Invalid JSON: expected array, { savedTabs: [] }, or grouped object.');
      return;
    }
    const importedCount = countTotalTabs(normalized);
    const nextGroups =
      mode === 'replace' ? normalized : mergeGroups(cloneGroups(currentGroups), normalized);
    const saved = await writeSavedGroups(nextGroups);
    if (!saved) {
      setStatus('Failed to save changes.');
      await refreshList();
      return;
    }
    applyGroups(nextGroups);
    setStatus(`Imported ${importedCount} tab${importedCount === 1 ? '' : 's'}, skipped 0.`);
  } catch {
    setStatus('Invalid JSON: could not parse.');
  }
}

async function importJson(): Promise<void> {
  if (!jsonAreaEl) return;
  await importJsonText(jsonAreaEl.value, 'append');
}

async function importJsonReplace(): Promise<void> {
  if (!jsonAreaEl) return;
  await importJsonText(jsonAreaEl.value, 'replace');
}

async function importJsonFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    if (jsonAreaEl) jsonAreaEl.value = text;
    await importJsonText(text, 'append');
  } catch {
    setStatus('Failed to read file.');
  }
}

async function getCurrentWindowKey(): Promise<string> {
  try {
    const currentTab = await chrome.tabs.getCurrent();
    if (currentTab && typeof currentTab.windowId === 'number') {
      return String(currentTab.windowId);
    }
  } catch {
    // ignore
  }
  return UNKNOWN_GROUP_KEY;
}

async function importOneTab(): Promise<void> {
  if (!jsonAreaEl) return;
  const text = jsonAreaEl.value;
  const totalLines = countOneTabNonEmptyLines(text);
  const imported = parseOneTabExport(text);
  const skipped = Math.max(0, totalLines - imported.length);
  if (imported.length === 0) {
    setStatus(`Imported 0 tabs, skipped ${skipped}.`);
    return;
  }
  const savedGroups = cloneGroups(currentGroups);
  const groupKey = await getCurrentWindowKey();
  const existing = savedGroups[groupKey] ?? [];
  savedGroups[groupKey] = [...existing, ...imported];
  const saved = await writeSavedGroups(savedGroups);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  applyGroups(savedGroups);
  setStatus(`Imported ${imported.length} tab${imported.length === 1 ? '' : 's'}, skipped ${skipped}.`);
}

async function init(): Promise<void> {
  await refreshList();

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

  importJsonReplaceEl?.addEventListener('click', () => {
    void importJsonReplace();
  });

  importFileEl?.addEventListener('click', () => {
    importFileInputEl?.click();
  });

  importFileInputEl?.addEventListener('change', () => {
    const file = importFileInputEl.files?.[0];
    if (file) {
      void importJsonFile(file);
      importFileInputEl.value = '';
    }
  });

  importOneTabEl?.addEventListener('click', () => {
    void importOneTab();
  });

  clearJsonEl?.addEventListener('click', () => {
    if (jsonAreaEl) jsonAreaEl.value = '';
    setStatus('Cleared text area.');
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.savedTabs) {
      void refreshList(normalizeSavedGroups(changes.savedTabs.newValue));
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

  window.addEventListener('scroll', scheduleScrollControlsUpdate, { passive: true });
  window.addEventListener('resize', scheduleScrollControlsUpdate);
  updateScrollControls();
}

void init();

function formatCreatedAt(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getListBottomScrollTarget(): number {
  if (!listSectionEl) return 0;
  const rect = listSectionEl.getBoundingClientRect();
  const listBottom = rect.bottom + window.scrollY;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const target = Math.max(0, listBottom - window.innerHeight + 16);
  return Math.min(target, maxScroll);
}

let scrollUpdateFrame = 0;

function scheduleScrollControlsUpdate(): void {
  if (scrollUpdateFrame) return;
  scrollUpdateFrame = window.requestAnimationFrame(() => {
    scrollUpdateFrame = 0;
    updateScrollControls();
  });
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

