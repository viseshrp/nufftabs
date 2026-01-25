import './style.css';
import { parseOneTabExport } from './onetab_import';
import {
  areGroupsEquivalent,
  cloneGroups,
  countTotalTabs,
  formatCreatedAt,
  getGroupCreatedAt,
  isSameGroup,
  mergeGroups,
  normalizeImportedGroups,
} from './list';
import { getReuseWindowContext, restoreTabs } from './restore';
import {
  LIST_PAGE_PATH,
  readSavedGroups,
  STORAGE_KEYS,
  isSavedGroupStorageKey,
  UNKNOWN_GROUP_KEY,
  writeSavedGroup,
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

// Render only a subset of each group at first paint to keep DOM size bounded; users can
// load additional rows in chunks via the "Load more" control.
const RENDER_PAGE_SIZE = 200;

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

function setStatus(message: string): void {
  if (!snackbarEl) return;
  snackbarEl.textContent = message;
  snackbarEl.classList.add('show');
  if (snackbarTimer) window.clearTimeout(snackbarTimer);
  snackbarTimer = window.setTimeout(() => {
    snackbarEl.classList.remove('show');
  }, 2200);
}

type GroupView = {
  card: HTMLElement;
  titleEl: HTMLDivElement;
  metaEl: HTMLDivElement;
  collapseButton: HTMLButtonElement;
  itemsWrap: HTMLDivElement;
  list: HTMLUListElement;
  loadMoreItem?: HTMLLIElement;
  loadMoreButton?: HTMLButtonElement;
  renderedCount: number;
};

const groupViews = new Map<string, GroupView>();

function updateGroupHeader(view: GroupView, tabs: SavedTab[], createdAt = getGroupCreatedAt(tabs)): void {
  view.titleEl.textContent = `${tabs.length} tab${tabs.length === 1 ? '' : 's'}`;
  view.metaEl.textContent = Number.isFinite(createdAt) ? `Created ${formatCreatedAt(createdAt)}` : 'Created -';
}

function ensureLoadMore(view: GroupView): void {
  if (view.loadMoreItem && view.loadMoreButton) return;
  const item = document.createElement('li');
  item.className = 'item load-more';
  const button = document.createElement('button');
  button.className = 'text-button';
  button.type = 'button';
  button.dataset.action = 'load-more';
  item.appendChild(button);
  view.loadMoreItem = item;
  view.loadMoreButton = button;
}

function updateLoadMore(view: GroupView, groupKey: string, tabs: SavedTab[]): void {
  const remaining = tabs.length - view.renderedCount;
  if (remaining <= 0) {
    if (view.loadMoreItem?.isConnected) view.loadMoreItem.remove();
    return;
  }
  if (!view.loadMoreItem || !view.loadMoreButton) ensureLoadMore(view);
  if (!view.loadMoreItem || !view.loadMoreButton) return;
  view.loadMoreButton.textContent = `Load ${Math.min(RENDER_PAGE_SIZE, remaining)} more (${remaining} remaining)`;
  view.loadMoreItem.dataset.groupKey = groupKey;
  if (!view.loadMoreItem.isConnected) view.list.appendChild(view.loadMoreItem);
}

function appendGroupItems(view: GroupView, groupKey: string, tabs: SavedTab[], start: number, end: number): void {
  const fragment = document.createDocumentFragment();
  for (let i = start; i < end; i += 1) {
    const tab = tabs[i];
    if (!tab) continue;
    const item = document.createElement('li');
    item.className = 'item';
    item.dataset.tabId = tab.id;
    item.dataset.groupKey = groupKey;

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
    restoreButton.type = 'button';
    restoreButton.dataset.action = 'restore-single';
    restoreButton.dataset.tabId = tab.id;
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

    const deleteButton = document.createElement('button');
    deleteButton.className = 'icon-button danger row-action';
    deleteButton.type = 'button';
    deleteButton.dataset.action = 'delete-single';
    deleteButton.dataset.tabId = tab.id;
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

    main.appendChild(tabTitle);
    main.appendChild(url);
    rowActions.appendChild(restoreButton);
    rowActions.appendChild(deleteButton);
    item.appendChild(main);
    item.appendChild(rowActions);
    fragment.appendChild(item);
  }
  view.list.appendChild(fragment);
}

function renderGroupItems(view: GroupView, groupKey: string, tabs: SavedTab[]): void {
  // Only render the initial chunk of rows; the rest are loaded on demand.
  view.list.replaceChildren();
  view.renderedCount = 0;
  const batchSize = Math.min(RENDER_PAGE_SIZE, tabs.length);
  appendGroupItems(view, groupKey, tabs, 0, batchSize);
  view.renderedCount = batchSize;
  updateLoadMore(view, groupKey, tabs);
}

function renderMoreItems(groupKey: string): void {
  const view = groupViews.get(groupKey);
  const tabs = currentGroups[groupKey];
  if (!view || !tabs) return;
  const nextCount = Math.min(tabs.length, view.renderedCount + RENDER_PAGE_SIZE);
  if (view.loadMoreItem?.isConnected) {
    view.loadMoreItem.remove();
  }
  appendGroupItems(view, groupKey, tabs, view.renderedCount, nextCount);
  view.renderedCount = nextCount;
  updateLoadMore(view, groupKey, tabs);
  updateScrollControls();
}

function createGroupView(groupKey: string): GroupView {
  const card = document.createElement('section');
  card.className = 'group-card';
  card.dataset.groupKey = groupKey;

  const header = document.createElement('div');
  header.className = 'group-header';

  const metaWrap = document.createElement('div');

  const title = document.createElement('div');
  title.className = 'group-title';

  const meta = document.createElement('div');
  meta.className = 'group-meta';

  metaWrap.appendChild(title);
  metaWrap.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'group-actions';

  const collapseButton = document.createElement('button');
  collapseButton.className = 'icon-button collapse-toggle';
  collapseButton.type = 'button';
  collapseButton.dataset.action = 'toggle-collapse';
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
  restoreAllButton.type = 'button';
  restoreAllButton.dataset.action = 'restore-group';
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

  const deleteAllButton = document.createElement('button');
  deleteAllButton.className = 'icon-button danger';
  deleteAllButton.type = 'button';
  deleteAllButton.dataset.action = 'delete-group';
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

  actions.appendChild(collapseButton);
  actions.appendChild(restoreAllButton);
  actions.appendChild(deleteAllButton);

  header.appendChild(metaWrap);
  header.appendChild(actions);

  const itemsWrap = document.createElement('div');
  itemsWrap.className = 'group-items';

  const list = document.createElement('ul');
  list.className = 'list';

  itemsWrap.appendChild(list);
  card.appendChild(header);
  card.appendChild(itemsWrap);

  return {
    card,
    titleEl: title,
    metaEl: meta,
    collapseButton,
    itemsWrap,
    list,
    renderedCount: 0,
  };
}

function renderGroups(savedGroups: SavedTabGroups, previousGroups: SavedTabGroups): void {
  if (!groupsEl || !emptyEl) return;
  const entries = Object.entries(savedGroups)
    .filter(([, tabs]) => tabs.length > 0)
    .map(([key, tabs]) => ({
      key,
      tabs,
      createdAt: getGroupCreatedAt(tabs),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
  const totalCount = entries.reduce((sum, entry) => sum + entry.tabs.length, 0);
  if (tabCountEl) tabCountEl.textContent = String(totalCount);

  if (totalCount === 0) {
    emptyEl.style.display = 'block';
    groupsEl.replaceChildren();
    groupViews.clear();
    updateScrollControls();
    return;
  }

  emptyEl.style.display = 'none';
  const activeKeys = new Set(entries.map((entry) => entry.key));
  for (const [key, view] of groupViews.entries()) {
    if (!activeKeys.has(key)) {
      view.card.remove();
      groupViews.delete(key);
    }
  }

  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const groupKey = entry.key;
    const tabs = entry.tabs;
    let view = groupViews.get(groupKey);
    if (!view) {
      view = createGroupView(groupKey);
      groupViews.set(groupKey, view);
    }
    updateGroupHeader(view, tabs, entry.createdAt);
    view.itemsWrap.hidden = view.card.classList.contains('is-collapsed');
    const previousTabs = previousGroups[groupKey];
    if (!isSameGroup(previousTabs, tabs)) {
      renderGroupItems(view, groupKey, tabs);
    } else {
      updateLoadMore(view, groupKey, tabs);
    }
    fragment.appendChild(view.card);
  }

  groupsEl.replaceChildren(fragment);
  updateScrollControls();
}

function handleGroupAction(event: Event): void {
  // Event delegation keeps listeners bounded; relies on data-action attributes and DOM
  // structure staying in sync. Markup changes can silently break actions.
  if (!groupsEl) return;
  const target = event.target as HTMLElement | null;
  if (!target) return;
  const button = target.closest<HTMLButtonElement>('button');
  if (!button || !groupsEl.contains(button)) return;
  const action = button.dataset.action;
  if (!action) return;
  const card = button.closest<HTMLElement>('[data-group-key]');
  const groupKey = card?.dataset.groupKey;

  switch (action) {
    case 'toggle-collapse': {
      if (!card || !groupKey) return;
      const isCollapsed = card.classList.toggle('is-collapsed');
      const label = isCollapsed ? 'Expand list' : 'Collapse list';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      const view = groupViews.get(groupKey);
      if (view) view.itemsWrap.hidden = isCollapsed;
      updateScrollControls();
      break;
    }
    case 'restore-group': {
      if (!groupKey) return;
      void restoreGroup(groupKey);
      break;
    }
    case 'delete-group': {
      if (!groupKey) return;
      void deleteGroup(groupKey);
      break;
    }
    case 'restore-single': {
      if (!groupKey) return;
      const tabId = button.dataset.tabId;
      if (tabId) void restoreSingle(groupKey, tabId);
      break;
    }
    case 'delete-single': {
      if (!groupKey) return;
      const tabId = button.dataset.tabId;
      if (tabId) void deleteSingle(groupKey, tabId);
      break;
    }
    case 'load-more': {
      if (!groupKey) return;
      renderMoreItems(groupKey);
      break;
    }
    default:
      break;
  }
}

function applyGroups(savedGroups: SavedTabGroups): void {
  if (areGroupsEquivalent(currentGroups, savedGroups)) return;
  const previous = currentGroups;
  currentGroups = savedGroups;
  renderGroups(savedGroups, previous);
}

async function refreshList(nextGroups?: SavedTabGroups): Promise<void> {
  const savedGroups = nextGroups ?? (await readSavedGroups());
  applyGroups(savedGroups);
}

async function restoreSingle(groupKey: string, id: string): Promise<void> {
  const groupTabs = currentGroups[groupKey] ?? [];
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
  const saved = await writeSavedGroup(groupKey, updatedGroup);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  const nextGroups = cloneGroups(currentGroups);
  if (updatedGroup.length > 0) {
    nextGroups[groupKey] = updatedGroup;
  } else {
    delete nextGroups[groupKey];
  }
  applyGroups(nextGroups);
  setStatus('Restored 1 tab.');
}

async function deleteSingle(groupKey: string, id: string): Promise<void> {
  const groupTabs = currentGroups[groupKey] ?? [];
  const updatedGroup = groupTabs.filter((entry) => entry.id !== id);
  if (updatedGroup.length === groupTabs.length) {
    setStatus('Tab not found.');
    return;
  }
  const saved = await writeSavedGroup(groupKey, updatedGroup);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  const nextGroups = cloneGroups(currentGroups);
  if (updatedGroup.length > 0) {
    nextGroups[groupKey] = updatedGroup;
  } else {
    delete nextGroups[groupKey];
  }
  applyGroups(nextGroups);
  setStatus('Deleted 1 tab.');
}

async function restoreGroup(groupKey: string): Promise<void> {
  const groupTabs = currentGroups[groupKey] ?? [];
  if (groupTabs.length === 0) {
    setStatus('No tabs to restore.');
    return;
  }

  const restored = await restoreTabs(groupTabs);
  if (!restored) {
    setStatus('Failed to restore tabs.');
    return;
  }

  const saved = await writeSavedGroup(groupKey, []);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  const nextGroups = cloneGroups(currentGroups);
  delete nextGroups[groupKey];
  applyGroups(nextGroups);
  setStatus('Restored all tabs.');
}

async function deleteGroup(groupKey: string): Promise<void> {
  const groupTabs = currentGroups[groupKey] ?? [];
  if (groupTabs.length === 0) {
    setStatus('No tabs to delete.');
    return;
  }
  const saved = await writeSavedGroup(groupKey, []);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  const nextGroups = cloneGroups(currentGroups);
  delete nextGroups[groupKey];
  applyGroups(nextGroups);
  setStatus('Deleted tabs.');
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
  const { tabs: imported, totalLines } = parseOneTabExport(text);
  const skipped = Math.max(0, totalLines - imported.length);
  if (imported.length === 0) {
    setStatus(`Imported 0 tabs, skipped ${skipped}.`);
    return;
  }
  const groupKey = await getCurrentWindowKey();
  const existing = currentGroups[groupKey] ?? [];
  const updatedGroup = [...existing, ...imported];
  const saved = await writeSavedGroup(groupKey, updatedGroup);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  const nextGroups = cloneGroups(currentGroups);
  nextGroups[groupKey] = updatedGroup;
  applyGroups(nextGroups);
  setStatus(`Imported ${imported.length} tab${imported.length === 1 ? '' : 's'}, skipped ${skipped}.`);
}

async function init(): Promise<void> {
  await refreshList();

  toggleIoEl?.addEventListener('click', () => {
    if (!ioPanelEl) return;
    ioPanelEl.hidden = !ioPanelEl.hidden;
    updateScrollControls();
  });

  groupsEl?.addEventListener('click', handleGroupAction);

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
    const changeKeys = Object.keys(changes);
    const hasSavedTabsChange =
      Boolean(changes[STORAGE_KEYS.savedTabsIndex]) ||
      changeKeys.some((key) => isSavedGroupStorageKey(key));
    if (!hasSavedTabsChange) return;
    void refreshList();
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

