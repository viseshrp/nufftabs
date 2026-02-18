import './style.css';
import { parseOneTabExport } from './onetab_import';
import {
  cloneGroups,
  countTotalTabs,
  formatCreatedAt,
  isSameGroup,
  mergeGroups,
  normalizeImportedGroups,
} from './list';
import { createDiscardSession, getReuseWindowContext, restoreTabs } from './restore';
import {
  readSettings,
  readSavedGroup,
  readSavedGroups,
  readSavedGroupsIndex,
  STORAGE_KEYS,
  GROUP_KEY_PREFIX,
  isSavedGroupStorageKey,
  UNKNOWN_GROUP_KEY,
  writeSavedGroup,
  writeSavedGroups,
  normalizeSettings,
  type SavedTab,
  type SavedTabGroups,
} from '../shared/storage';
import { logExtensionError, type ExtensionErrorOperation } from '../shared/utils';

const groupsEl = document.querySelector<HTMLDivElement>('#groups');
const emptyEl = document.querySelector<HTMLDivElement>('#empty');
const snackbarEl = document.querySelector<HTMLDivElement>('#snackbar');
const listSectionEl = document.querySelector<HTMLElement>('.list-section');
const expandAllEl = document.querySelector<HTMLButtonElement>('#expandAll');
const collapseAllEl = document.querySelector<HTMLButtonElement>('#collapseAll');
const scrollTopEl = document.querySelector<HTMLButtonElement>('#scrollTop');
const scrollBottomEl = document.querySelector<HTMLButtonElement>('#scrollBottom');
const tabCountEl = document.querySelector<HTMLSpanElement>('#tabCount');
const searchTabsEl = document.querySelector<HTMLInputElement>('#searchTabs');
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

type ListPageState = {
  snackbarTimer?: number;
  currentGroups: SavedTabGroups;
  visibleGroups: SavedTabGroups;
  activeSearchTerm: string;
  draggedTab: { groupKey: string; tabId: string } | null;
  totalTabCount: number;
  indexedGroupKeys: string[];
  indexedGroupKeySet: Set<string>;
  groupLoadTasks: Map<string, Promise<SavedTab[]>>;
  viewportLoadFrame: number;
  searchLoadToken: number;
  scrollUpdateFrame: number;
  renderGroupsFrame: number;
  renderGroupsScheduled: boolean;
  renderGroupsFallbackTimer?: number;
};

const state: ListPageState = {
  snackbarTimer: undefined,
  currentGroups: {},
  visibleGroups: {},
  activeSearchTerm: '',
  draggedTab: null,
  totalTabCount: 0,
  indexedGroupKeys: [],
  indexedGroupKeySet: new Set<string>(),
  groupLoadTasks: new Map<string, Promise<SavedTab[]>>(),
  viewportLoadFrame: 0,
  searchLoadToken: 0,
  scrollUpdateFrame: 0,
  renderGroupsFrame: 0,
  renderGroupsScheduled: false,
  renderGroupsFallbackTimer: undefined,
};

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
  if (state.snackbarTimer) window.clearTimeout(state.snackbarTimer);
  state.snackbarTimer = window.setTimeout(() => {
    snackbarEl.classList.remove('show');
  }, 2200);
}

function runAsyncTask(
  task: Promise<unknown>,
  context: string,
  operation: ExtensionErrorOperation = 'runtime_context',
): void {
  void task.catch((error) => {
    logExtensionError(context, error, { operation });
  });
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
  hasUserInteraction: boolean;
};

const groupViews = new Map<string, GroupView>();

function applyTheme(theme: 'os' | 'light' | 'dark'): void {
  if (theme === 'os') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

async function initTheme(): Promise<void> {
  const settings = await readSettings();
  applyTheme(settings.theme);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.settings]) {
      const newSettings = normalizeSettings(changes[STORAGE_KEYS.settings].newValue);
      applyTheme(newSettings.theme);
    }
  });
}

runAsyncTask(initTheme(), 'Failed to initialize theme');

function updateGroupHeader(
  view: GroupView,
  totalTabCount: number,
  visibleTabCount: number,
  createdAt: number,
): void {
  if (state.activeSearchTerm && visibleTabCount !== totalTabCount) {
    view.titleEl.textContent = `${visibleTabCount} of ${totalTabCount} tabs`;
  } else {
    view.titleEl.textContent = `${totalTabCount} tab${totalTabCount === 1 ? '' : 's'}`;
  }
  view.metaEl.textContent = createdAt > 0 ? `Created ${formatCreatedAt(createdAt)}` : 'Created -';
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
    item.draggable = true;

    item.addEventListener('dragstart', (e) => {
      if (e.dataTransfer) {
        state.draggedTab = { groupKey, tabId: tab.id };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.url);
        // Defer class addition to avoid hiding the element immediately during drag generation
        window.requestAnimationFrame(() => {
          item.classList.add('is-dragging');
        });
      }
    });

    item.addEventListener('dragend', () => {
      state.draggedTab = null;
      item.classList.remove('is-dragging');
    });

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
  const tabs = state.visibleGroups[groupKey];
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

function setGroupCollapseState(view: GroupView, collapsed: boolean): void {
  view.card.classList.toggle('is-collapsed', collapsed);
  view.itemsWrap.hidden = collapsed;
  const label = collapsed ? 'Expand list' : 'Collapse list';
  view.collapseButton.setAttribute('aria-label', label);
  view.collapseButton.setAttribute('title', label);
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

  itemsWrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (state.draggedTab && state.draggedTab.groupKey !== groupKey) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      itemsWrap.classList.add('drag-over');
    }
  });

  itemsWrap.addEventListener('dragleave', () => {
    itemsWrap.classList.remove('drag-over');
  });

  itemsWrap.addEventListener('drop', (e) => {
    e.preventDefault();
    itemsWrap.classList.remove('drag-over');
    if (state.draggedTab && state.draggedTab.groupKey !== groupKey) {
      runAsyncTask(handleDrop(groupKey), 'Failed to move tab between groups');
    }
  });

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
    hasUserInteraction: false,
  };
}

function parseGroupCreationTime(key: string): number | null {
  const parts = key.split('-');
  if (parts.length < 3) return null;
  const timestamp = Number(parts[1]);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function normalizeSearchTerm(value: string): string {
  return value.trim().toLowerCase();
}

function filterGroupTabs(tabs: SavedTab[], searchTerm: string): SavedTab[] {
  if (!searchTerm) return tabs;
  return tabs.filter((tab) => {
    const title = tab.title.toLowerCase();
    const url = tab.url.toLowerCase();
    return title.includes(searchTerm) || url.includes(searchTerm);
  });
}

function updateEmptyStateText(message: 'saved' | 'matching'): void {
  if (!emptyEl) return;
  const label = emptyEl.querySelector('div');
  if (!label) return;
  if (message === 'saved') {
    label.textContent = 'No saved tabs';
    return;
  }
  label.textContent = 'No matching tabs';
}

function getSortedGroupKeys(): string[] {
  return state.indexedGroupKeys
    .slice()
    .sort((a, b) => (parseGroupCreationTime(b) ?? 0) - (parseGroupCreationTime(a) ?? 0));
}

function isGroupLoaded(groupKey: string): boolean {
  return Object.hasOwn(state.currentGroups, groupKey);
}

function upsertIndexedGroupKey(groupKey: string): void {
  if (state.indexedGroupKeySet.has(groupKey)) return;
  state.indexedGroupKeys.push(groupKey);
  state.indexedGroupKeySet.add(groupKey);
}

function removeIndexedGroupKey(groupKey: string): void {
  if (!state.indexedGroupKeySet.has(groupKey)) return;
  state.indexedGroupKeys = state.indexedGroupKeys.filter((key) => key !== groupKey);
  state.indexedGroupKeySet.delete(groupKey);
  delete state.currentGroups[groupKey];
  delete state.visibleGroups[groupKey];
  state.groupLoadTasks.delete(groupKey);
}

function setIndexedGroups(nextKeys: string[]): void {
  state.indexedGroupKeys = nextKeys.slice();
  state.indexedGroupKeySet = new Set(nextKeys);
  for (const key of Object.keys(state.currentGroups)) {
    if (!state.indexedGroupKeySet.has(key)) delete state.currentGroups[key];
  }
  for (const key of Object.keys(state.visibleGroups)) {
    if (!state.indexedGroupKeySet.has(key)) delete state.visibleGroups[key];
  }
  for (const key of state.groupLoadTasks.keys()) {
    if (!state.indexedGroupKeySet.has(key)) state.groupLoadTasks.delete(key);
  }
}

function applyLoadedGroup(groupKey: string, tabs: SavedTab[]): void {
  if (tabs.length > 0) {
    upsertIndexedGroupKey(groupKey);
    state.currentGroups[groupKey] = tabs;
  } else {
    removeIndexedGroupKey(groupKey);
  }
  scheduleRenderGroups();
}

function applyFullGroups(nextGroups: SavedTabGroups): void {
  const keys = Object.keys(nextGroups);
  setIndexedGroups(keys);
  state.currentGroups = cloneGroups(nextGroups);
  scheduleRenderGroups();
}

async function ensureGroupLoaded(groupKey: string): Promise<SavedTab[]> {
  if (!state.indexedGroupKeySet.has(groupKey)) return [];
  if (isGroupLoaded(groupKey)) return state.currentGroups[groupKey] ?? [];
  const pending = state.groupLoadTasks.get(groupKey);
  if (pending) return pending;

  const task = (async () => {
    const tabs = await readSavedGroup(groupKey);
    if (!state.indexedGroupKeySet.has(groupKey)) return tabs;
    state.currentGroups[groupKey] = tabs;
    scheduleRenderGroups();
    return tabs;
  })().finally(() => {
    state.groupLoadTasks.delete(groupKey);
  });

  state.groupLoadTasks.set(groupKey, task);
  return task;
}

async function loadGroupsNearViewport(): Promise<void> {
  if (state.activeSearchTerm || state.indexedGroupKeys.length === 0) return;
  const preload = Math.max(window.innerHeight, 600);
  const toLoad: string[] = [];

  for (const [key, view] of groupViews.entries()) {
    if (!state.indexedGroupKeySet.has(key) || isGroupLoaded(key) || state.groupLoadTasks.has(key)) continue;
    const rect = view.card.getBoundingClientRect();
    const nearViewport = rect.top <= window.innerHeight + preload && rect.bottom >= -preload;
    if (nearViewport) toLoad.push(key);
  }

  if (toLoad.length === 0) {
    const fallback = getSortedGroupKeys().find((key) => !isGroupLoaded(key));
    if (fallback) toLoad.push(fallback);
  }

  await Promise.all(toLoad.map((key) => ensureGroupLoaded(key)));
}

function scheduleViewportGroupLoad(): void {
  if (state.activeSearchTerm) return;
  if (state.viewportLoadFrame) return;
  state.viewportLoadFrame = window.requestAnimationFrame(() => {
    state.viewportLoadFrame = 0;
    runAsyncTask(loadGroupsNearViewport(), 'Failed to load groups for viewport');
  });
}

async function loadGroupsForSearch(loadToken: number): Promise<void> {
  for (const groupKey of getSortedGroupKeys()) {
    if (loadToken !== state.searchLoadToken || !state.activeSearchTerm) return;
    if (isGroupLoaded(groupKey)) continue;
    await ensureGroupLoaded(groupKey);
  }
}

function scheduleSearchGroupLoad(): void {
  if (!state.activeSearchTerm) return;
  state.searchLoadToken += 1;
  runAsyncTask(loadGroupsForSearch(state.searchLoadToken), 'Failed to load groups for search');
}

function setTabCount(count: number): void {
  state.totalTabCount = Math.max(0, count);
  if (!tabCountEl) return;
  tabCountEl.textContent = String(state.totalTabCount);
}

function adjustTabCount(delta: number): void {
  setTabCount(state.totalTabCount + delta);
}

async function refreshTotalTabCount(): Promise<void> {
  const savedGroups = await readSavedGroups();
  setTabCount(countTotalTabs(savedGroups));
}

function areAllIndexedGroupsLoaded(): boolean {
  return state.indexedGroupKeys.every((groupKey) => isGroupLoaded(groupKey));
}

function cancelScheduledRenderGroups(): void {
  if (state.renderGroupsFrame) {
    window.cancelAnimationFrame(state.renderGroupsFrame);
    state.renderGroupsFrame = 0;
  }
  if (state.renderGroupsFallbackTimer) {
    window.clearTimeout(state.renderGroupsFallbackTimer);
    state.renderGroupsFallbackTimer = undefined;
  }
  state.renderGroupsScheduled = false;
}

function scheduleRenderGroups(): void {
  if (state.renderGroupsScheduled) return;
  state.renderGroupsScheduled = true;
  const flush = () => {
    if (!state.renderGroupsScheduled) return;
    state.renderGroupsScheduled = false;
    if (state.renderGroupsFallbackTimer) {
      window.clearTimeout(state.renderGroupsFallbackTimer);
      state.renderGroupsFallbackTimer = undefined;
    }
    state.renderGroupsFrame = 0;
    renderGroups();
  };
  state.renderGroupsFrame = window.requestAnimationFrame(() => {
    flush();
  });
  // Fallback for test environments where requestAnimationFrame may be stubbed as a no-op.
  state.renderGroupsFallbackTimer = window.setTimeout(flush, 0);
}

function renderGroups(): void {
  if (!groupsEl || !emptyEl) return;
  const entries = getSortedGroupKeys()
    .map((groupKey) => {
      const createdAt = parseGroupCreationTime(groupKey) ?? 0;
      const loaded = isGroupLoaded(groupKey);
      const tabs = loaded ? (state.currentGroups[groupKey] ?? []) : [];
      if (loaded && tabs.length === 0) return null;
      const visibleTabs = state.activeSearchTerm ? filterGroupTabs(tabs, state.activeSearchTerm) : tabs;
      if (state.activeSearchTerm && (!loaded || visibleTabs.length === 0)) return null;
      return {
        groupKey,
        createdAt,
        loaded,
        tabs,
        visibleTabs,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const hasSavedTabs = state.indexedGroupKeys.length > 0;
  const hasEntries = entries.length > 0;
  if (!hasSavedTabs || !hasEntries) {
    emptyEl.style.display = 'block';
    updateEmptyStateText(state.activeSearchTerm && hasSavedTabs ? 'matching' : 'saved');
  } else {
    emptyEl.style.display = 'none';
  }

  const activeKeys = new Set(entries.map((entry) => entry.groupKey));
  for (const [key, view] of groupViews.entries()) {
    if (!activeKeys.has(key)) {
      view.card.remove();
      groupViews.delete(key);
    }
  }

  const fragment = document.createDocumentFragment();
  const nextVisibleGroups: SavedTabGroups = {};

  for (const [index, entry] of entries.entries()) {
    const { groupKey, createdAt, loaded, tabs, visibleTabs } = entry;
    let view = groupViews.get(groupKey);
    if (!view) {
      view = createGroupView(groupKey);
      groupViews.set(groupKey, view);
    }

    // Default collapse behavior: collapse all groups except the most recent one (index 0).
    // Enforce this state until the user interacts with the group or a global action occurs.
    // Default collapse behavior: collapse all groups except the most recent one (index 0).
    // Enforce this state until the user interacts with the group or a global action occurs.
    if (!view.hasUserInteraction) {
      const shouldBeCollapsed = index > 0;
      const isCollapsed = view.card.classList.contains('is-collapsed');
      if (shouldBeCollapsed !== isCollapsed) {
        setGroupCollapseState(view, shouldBeCollapsed);
      }
    }

    if (loaded) {
      updateGroupHeader(view, tabs.length, visibleTabs.length, createdAt);
      nextVisibleGroups[groupKey] = visibleTabs;
      const previousTabs = state.visibleGroups[groupKey];
      if (!isSameGroup(previousTabs, visibleTabs)) {
        renderGroupItems(view, groupKey, visibleTabs);
      } else {
        updateLoadMore(view, groupKey, visibleTabs);
      }
    } else {
      view.titleEl.textContent = 'Loading tabs...';
      view.metaEl.textContent = createdAt > 0 ? `Created ${formatCreatedAt(createdAt)}` : 'Created -';
      if (view.loadMoreItem?.isConnected) view.loadMoreItem.remove();
      if (view.list.childElementCount > 0) {
        view.list.replaceChildren();
      }
      view.renderedCount = 0;
    }

    view.itemsWrap.hidden = view.card.classList.contains('is-collapsed');
    fragment.appendChild(view.card);
  }

  groupsEl.replaceChildren(fragment);
  state.visibleGroups = nextVisibleGroups;
  updateScrollControls();

  if (!state.activeSearchTerm) {
    scheduleViewportGroupLoad();
  }
}

async function refreshList(changedGroupKeys?: string[]): Promise<void> {
  if (changedGroupKeys && changedGroupKeys.length > 0) {
    for (const groupKey of changedGroupKeys) {
      delete state.currentGroups[groupKey];
      delete state.visibleGroups[groupKey];
      state.groupLoadTasks.delete(groupKey);
    }
  }
  const index = await readSavedGroupsIndex();
  setIndexedGroups(index);
  cancelScheduledRenderGroups();
  renderGroups();
  if (state.activeSearchTerm) {
    state.searchLoadToken += 1;
    await loadGroupsForSearch(state.searchLoadToken);
  } else {
    await loadGroupsNearViewport();
  }
  await refreshTotalTabCount();
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
      const view = groupViews.get(groupKey);
      if (!view) return;

      view.hasUserInteraction = true;
      const isCollapsed = !view.card.classList.contains('is-collapsed');
      setGroupCollapseState(view, isCollapsed);

      if (!isCollapsed && !isGroupLoaded(groupKey)) {
        runAsyncTask(ensureGroupLoaded(groupKey), `Failed to load group (${groupKey})`);
      }
      updateScrollControls();
      break;
    }
    case 'restore-group': {
      if (!groupKey) return;
      runAsyncTask(restoreGroup(groupKey), 'Failed to restore group');
      break;
    }
    case 'delete-group': {
      if (!groupKey) return;
      runAsyncTask(deleteGroup(groupKey), 'Failed to delete group');
      break;
    }
    case 'restore-single': {
      if (!groupKey) return;
      const tabId = button.dataset.tabId;
      if (tabId) runAsyncTask(restoreSingle(groupKey, tabId), 'Failed to restore tab');
      break;
    }
    case 'delete-single': {
      if (!groupKey) return;
      const tabId = button.dataset.tabId;
      if (tabId) runAsyncTask(deleteSingle(groupKey, tabId), 'Failed to delete tab');
      break;
    }
    case 'load-more': {
      if (!groupKey) return;
      if (!isGroupLoaded(groupKey)) {
        runAsyncTask(ensureGroupLoaded(groupKey), `Failed to load group (${groupKey})`);
        return;
      }
      renderMoreItems(groupKey);
      break;
    }
    default:
      break;
  }
}

async function restoreSingle(groupKey: string, id: string): Promise<void> {
  const groupTabs = await ensureGroupLoaded(groupKey);
  const tab = groupTabs.find((entry) => entry.id === id);
  if (!tab) {
    setStatus('Tab not found.');
    return;
  }

  try {
    const settings = await readSettings();
    const reuse = await getReuseWindowContext();
    if (typeof reuse.windowId === 'number') {
      const created = await chrome.tabs.create({ windowId: reuse.windowId, url: tab.url, active: false });
      if (typeof reuse.tabId === 'number') {
        await chrome.tabs.update(reuse.tabId, { active: true });
      }
      if (settings.discardRestoredTabs && typeof created.id === 'number') {
        const discardSession = createDiscardSession();
        discardSession.schedule([created.id]);
      }
    } else {
      const createdWindow = await chrome.windows.create({ url: tab.url });
      if (!createdWindow || typeof createdWindow.id !== 'number') {
        throw new Error('Missing window id');
      }
      if (settings.discardRestoredTabs) {
        const discardSession = createDiscardSession();
        const firstTabId = createdWindow.tabs?.[0]?.id;
        if (typeof firstTabId === 'number') {
          discardSession.schedule([firstTabId]);
        } else {
          try {
            const windowTabs = await chrome.tabs.query({ windowId: createdWindow.id });
            discardSession.schedule(windowTabs.map((entry) => entry.id));
          } catch (error) {
            logExtensionError('Failed to query window tabs for discard fallback', error, { operation: 'tab_query' });
            // Ignore discard failures for best-effort behavior.
          }
        }
      }
    }
  } catch (error) {
    logExtensionError('Failed to restore tab', error, { operation: 'tab_query' });
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
  applyLoadedGroup(groupKey, updatedGroup);
  adjustTabCount(-1);
  setStatus('Restored 1 tab.');
}

async function deleteSingle(groupKey: string, id: string): Promise<void> {
  const groupTabs = await ensureGroupLoaded(groupKey);
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
  applyLoadedGroup(groupKey, updatedGroup);
  adjustTabCount(-1);
  setStatus('Deleted 1 tab.');
}

async function restoreGroup(groupKey: string): Promise<void> {
  const groupTabs = await ensureGroupLoaded(groupKey);
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
  removeIndexedGroupKey(groupKey);
  scheduleRenderGroups();
  adjustTabCount(-groupTabs.length);
  setStatus('Restored all tabs.');
}

async function deleteGroup(groupKey: string): Promise<void> {
  const groupTabs = await ensureGroupLoaded(groupKey);
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
  removeIndexedGroupKey(groupKey);
  scheduleRenderGroups();
  adjustTabCount(-groupTabs.length);
  setStatus('Deleted tabs.');
}


async function handleDrop(targetGroupKey: string): Promise<void> {
  if (!state.draggedTab) return;
  const { groupKey: sourceGroupKey, tabId } = state.draggedTab;
  if (sourceGroupKey === targetGroupKey) return;

  const sourceCurrent = await ensureGroupLoaded(sourceGroupKey);
  const targetCurrent = await ensureGroupLoaded(targetGroupKey);
  const sourceGroup = [...sourceCurrent];
  if (sourceGroup.length === 0) return;

  const tabIndex = sourceGroup.findIndex((t) => t.id === tabId);
  if (tabIndex === -1) return;

  const [tab] = sourceGroup.splice(tabIndex, 1);
  if (!tab) return;

  const targetGroup = [...targetCurrent];
  targetGroup.unshift(tab);

  const sourceSaved = await writeSavedGroup(sourceGroupKey, sourceGroup);
  if (!sourceSaved) {
    setStatus('Failed to move tab.');
    await refreshList();
    return;
  }
  const targetSaved = await writeSavedGroup(targetGroupKey, targetGroup);
  if (!targetSaved) {
    await writeSavedGroup(sourceGroupKey, sourceCurrent);
    setStatus('Failed to move tab.');
    await refreshList();
    return;
  }

  if (sourceGroup.length === 0) {
    removeIndexedGroupKey(sourceGroupKey);
  } else {
    state.currentGroups[sourceGroupKey] = sourceGroup;
  }
  upsertIndexedGroupKey(targetGroupKey);
  state.currentGroups[targetGroupKey] = targetGroup;
  scheduleRenderGroups();
  setStatus('Moved 1 tab.');
}

async function exportJson(): Promise<void> {
  if (!jsonAreaEl) return;
  const savedGroups = areAllIndexedGroupsLoaded() ? cloneGroups(state.currentGroups) : await readSavedGroups();
  const total = countTotalTabs(savedGroups);
  jsonAreaEl.value = JSON.stringify({ savedTabs: savedGroups }, null, 2);

  let copied = false;
  try {
    await navigator.clipboard.writeText(jsonAreaEl.value);
    copied = true;
  } catch (error) {
    logExtensionError('Failed to copy export JSON to clipboard', error, { operation: 'runtime_context' });
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
  } catch (error) {
    logExtensionError('Failed to download export JSON', error, { operation: 'runtime_context' });
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
    const existing = mode === 'replace' ? {} : await readSavedGroups();
    const nextGroups =
      mode === 'replace' ? normalized : mergeGroups(existing, normalized);
    const saved = await writeSavedGroups(nextGroups);
    if (!saved) {
      setStatus('Failed to save changes.');
      await refreshList();
      return;
    }
    applyFullGroups(nextGroups);
    setTabCount(countTotalTabs(nextGroups));
    setStatus(`Imported ${importedCount} tab${importedCount === 1 ? '' : 's'}, skipped 0.`);
  } catch (error) {
    logExtensionError('Failed to import JSON payload', error, { operation: 'runtime_context' });
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
  } catch (error) {
    logExtensionError('Failed to import JSON file', error, { operation: 'runtime_context' });
    setStatus('Failed to read file.');
  }
}

async function getCurrentWindowKey(): Promise<string> {
  try {
    const currentTab = await chrome.tabs.getCurrent();
    if (currentTab && typeof currentTab.windowId === 'number') {
      return String(currentTab.windowId);
    }
  } catch (error) {
    logExtensionError('Failed to get current window key', error, { operation: 'tab_query' });
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
  const existing = state.indexedGroupKeySet.has(groupKey) ? await ensureGroupLoaded(groupKey) : [];
  const updatedGroup = [...existing, ...imported];
  const saved = await writeSavedGroup(groupKey, updatedGroup);
  if (!saved) {
    setStatus('Failed to save changes.');
    await refreshList();
    return;
  }
  upsertIndexedGroupKey(groupKey);
  state.currentGroups[groupKey] = updatedGroup;
  scheduleRenderGroups();
  adjustTabCount(imported.length);
  setStatus(`Imported ${imported.length} tab${imported.length === 1 ? '' : 's'}, skipped ${skipped}.`);
}

async function init(): Promise<void> {
  state.activeSearchTerm = normalizeSearchTerm(searchTabsEl?.value ?? '');
  await refreshList();

  searchTabsEl?.addEventListener('input', () => {
    const nextSearchTerm = normalizeSearchTerm(searchTabsEl.value);
    if (nextSearchTerm === state.activeSearchTerm) return;
    state.activeSearchTerm = nextSearchTerm;
    scheduleRenderGroups();
    if (state.activeSearchTerm) {
      scheduleSearchGroupLoad();
    }
  });

  toggleIoEl?.addEventListener('click', () => {
    if (!ioPanelEl) return;
    ioPanelEl.hidden = !ioPanelEl.hidden;
    updateScrollControls();
  });

  groupsEl?.addEventListener('click', handleGroupAction);

  exportJsonEl?.addEventListener('click', () => {
    runAsyncTask(exportJson(), 'Failed to export JSON');
  });

  importJsonEl?.addEventListener('click', () => {
    runAsyncTask(importJson(), 'Failed to import JSON (append)');
  });

  importJsonReplaceEl?.addEventListener('click', () => {
    runAsyncTask(importJsonReplace(), 'Failed to import JSON (replace)');
  });

  importFileEl?.addEventListener('click', () => {
    importFileInputEl?.click();
  });

  importFileInputEl?.addEventListener('change', () => {
    const file = importFileInputEl.files?.[0];
    if (file) {
      runAsyncTask(importJsonFile(file), 'Failed to import JSON file');
      importFileInputEl.value = '';
    }
  });

  importOneTabEl?.addEventListener('click', () => {
    runAsyncTask(importOneTab(), 'Failed to import OneTab export');
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
    const changedGroupKeys = changeKeys
      .filter((key) => isSavedGroupStorageKey(key))
      .map((key) => key.slice(GROUP_KEY_PREFIX.length));
    runAsyncTask(refreshList(changedGroupKeys), 'Failed to refresh tab list after storage change');
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      runAsyncTask(refreshList(), 'Failed to refresh tab list after visibility change');
    }
  });

  expandAllEl?.addEventListener('click', () => {
    runAsyncTask(expandAll(), 'Failed to expand all groups');
  });

  collapseAllEl?.addEventListener('click', () => {
    collapseAll();
  });

  scrollTopEl?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  scrollBottomEl?.addEventListener('click', () => {
    const target = getListBottomScrollTarget();
    window.scrollTo({ top: target, behavior: 'smooth' });
  });

  window.addEventListener(
    'scroll',
    () => {
      scheduleScrollControlsUpdate();
      scheduleViewportGroupLoad();
    },
    { passive: true },
  );
  window.addEventListener('resize', () => {
    scheduleScrollControlsUpdate();
    scheduleViewportGroupLoad();
  });
  updateScrollControls();
  scheduleViewportGroupLoad();
}

runAsyncTask(init(), 'Failed to initialize nufftabs page');

function getListBottomScrollTarget(): number {
  if (!listSectionEl) return 0;
  const rect = listSectionEl.getBoundingClientRect();
  const listBottom = rect.bottom + window.scrollY;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const target = Math.max(0, listBottom - window.innerHeight + 16);
  return Math.min(target, maxScroll);
}

function scheduleScrollControlsUpdate(): void {
  if (state.scrollUpdateFrame) return;
  state.scrollUpdateFrame = window.requestAnimationFrame(() => {
    state.scrollUpdateFrame = 0;
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

/**
 * Expands all group lists and loads their content if needed.
 */
async function expandAll(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const [key, view] of groupViews.entries()) {
    view.hasUserInteraction = true;
    if (view.card.classList.contains('is-collapsed')) {
      setGroupCollapseState(view, false);

      // If the group isn't loaded, trigger a load so content appears.
      if (!isGroupLoaded(key)) {
        tasks.push(ensureGroupLoaded(key));
      }
    }
  }
  updateScrollControls();
  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

/**
 * Collapses all group lists.
 */
function collapseAll(): void {
  for (const view of groupViews.values()) {
    view.hasUserInteraction = true;
    if (!view.card.classList.contains('is-collapsed')) {
      setGroupCollapseState(view, true);
    }
  }
  updateScrollControls();
}
