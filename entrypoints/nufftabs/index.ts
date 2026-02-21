/**
 * Main list page UI for the nufftabs extension.
 * Handles rendering saved tab groups, search filtering, drag-and-drop
 * reordering, group collapse/expand, import/export, and tab restoration.
 */
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
import { createCondenseGroupKey } from '../shared/condense';
import { createDiscardSession, getReuseWindowContext, restoreTabs } from './restore';
import {
  readSettings,
  readSavedGroup,
  readSavedGroups,
  readSavedGroupsIndex,
  STORAGE_KEYS,
  GROUP_KEY_PREFIX,
  isSavedGroupStorageKey,
  writeSavedGroup,
  writeSavedGroups,
  normalizeSettings,
  type SavedTab,
  type SavedTabGroups,
} from '../shared/storage';
import { appendTabsByDuplicatePolicy, collectSavedTabUrls } from '../shared/duplicates';
import { logExtensionError, type ExtensionErrorOperation } from '../shared/utils';
import { createSnackbarNotifier } from '../ui/notifications';

// ── DOM element references (queried once at module load) ──
const groupsEl = document.querySelector<HTMLDivElement>('#groups');
const emptyEl = document.querySelector<HTMLDivElement>('#empty');
const snackbarEl = document.querySelector<HTMLDivElement>('#snackbar');
const listSectionEl = document.querySelector<HTMLElement>('.list-section');
const scrollTopEl = document.querySelector<HTMLButtonElement>('#scrollTop');
const scrollBottomEl = document.querySelector<HTMLButtonElement>('#scrollBottom');
const tabCountEl = document.querySelector<HTMLSpanElement>('#tabCount');
const searchTabsEl = document.querySelector<HTMLInputElement>('#searchTabs');
const toggleIoEl = document.querySelector<HTMLButtonElement>('#toggleIo');
/** Button that collapses or expands every group card at once. */
const toggleCollapseAllEl = document.querySelector<HTMLButtonElement>('#toggleCollapseAll');
/** Button that performs a one-time global duplicate cleanup across all saved groups. */
const mergeDuplicatesEl = document.querySelector<HTMLButtonElement>('#mergeDuplicates');
const exportJsonEl = document.querySelector<HTMLButtonElement>('#exportJson');
const importJsonEl = document.querySelector<HTMLButtonElement>('#importJson');
const importJsonReplaceEl = document.querySelector<HTMLButtonElement>('#importJsonReplace');
const importFileEl = document.querySelector<HTMLButtonElement>('#importFile');
const importFileInputEl = document.querySelector<HTMLInputElement>('#importFileInput');
const importOneTabEl = document.querySelector<HTMLButtonElement>('#importOneTab');
const clearJsonEl = document.querySelector<HTMLButtonElement>('#clearJson');
const jsonAreaEl = document.querySelector<HTMLTextAreaElement>('#jsonArea');
const ioPanelEl = document.querySelector<HTMLElement>('#ioPanel');

/** SVG namespace URI used when creating inline SVG icons. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Mutable application state for the list page UI. */
type ListPageState = {
  /** Full tab arrays keyed by group key (loaded from storage). */
  currentGroups: SavedTabGroups;
  /** Filtered tab arrays after applying the active search term. */
  visibleGroups: SavedTabGroups;
  activeSearchTerm: string;
  draggedTab: { groupKey: string; tabId: string } | null;
  totalTabCount: number;
  /** Ordered list of known group keys from the storage index. */
  indexedGroupKeys: string[];
  indexedGroupKeySet: Set<string>;
  /** In-flight load promises per group key to avoid duplicate fetches. */
  groupLoadTasks: Map<string, Promise<SavedTab[]>>;
  viewportLoadFrame: number;
  searchLoadToken: number;
  scrollUpdateFrame: number;
  renderGroupsFrame: number;
  renderGroupsScheduled: boolean;
  renderGroupsFallbackTimer?: number;
  /** Tracks whether all group cards are currently collapsed. */
  allGroupsCollapsed: boolean;
  /** Guards initial collapse so it only runs once on first render. */
  initialCollapseApplied: boolean;
};

/** Singleton mutable state object for the list page. */
const state: ListPageState = {
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
  allGroupsCollapsed: false,
  initialCollapseApplied: false,
};

/**
 * Centralized page notifier used for every user-facing status message.
 * Keeping one notifier here ensures all transient messages use the same timing behavior.
 */
const userNotifier = createSnackbarNotifier(snackbarEl);

/** Maximum number of tab rows to render per group before showing a "Load more" control. */
const RENDER_PAGE_SIZE = 200;

/** Descriptor for a child element inside an SVG icon. */
type SvgElementSpec = {
  tag: 'path' | 'rect';
  attrs: Record<string, string>;
};

/** Creates an inline SVG element from an array of child element descriptors. */
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

/** Briefly shows a snackbar notification with the given message. */
function setStatus(message: string): void {
  userNotifier.notify(message);
}

/** Fires-and-forgets an async task, logging errors with the given context string. */
function runAsyncTask(
  task: Promise<unknown>,
  context: string,
  operation: ExtensionErrorOperation = 'runtime_context',
): void {
  void task.catch((error) => {
    logExtensionError(context, error, { operation });
  });
}

/** Holds the DOM nodes and render state for a single group card. */
type GroupView = {
  card: HTMLElement;
  titleEl: HTMLDivElement;
  metaEl: HTMLDivElement;
  collapseButton: HTMLButtonElement;
  itemsWrap: HTMLDivElement;
  list: HTMLUListElement;
  loadMoreItem?: HTMLLIElement;
  loadMoreButton?: HTMLButtonElement;
  /** Number of tab rows currently rendered from the group's tab array. */
  renderedCount: number;
};

/** Cache of group-key → GroupView for all currently rendered group cards. */
const groupViews = new Map<string, GroupView>();

/** Applies the given color theme to the document element via data attribute. */
function applyTheme(theme: 'os' | 'light' | 'dark'): void {
  if (theme === 'os') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

/** Reads and applies the persisted theme, and listens for live theme changes. */
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

/** Updates a group card's header text (tab count and creation timestamp). */
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

/** Lazily creates the "Load more" list item and button for a group card. */
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

/** Shows, updates, or hides the "Load more" control based on remaining un-rendered tabs. */
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

/** Renders a range of tab items into a group's list element using a document fragment. */
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

/** Replaces a group's rendered items with the initial page of tabs. */
function renderGroupItems(view: GroupView, groupKey: string, tabs: SavedTab[]): void {
  // Only render the initial chunk of rows; the rest are loaded on demand.
  view.list.replaceChildren();
  view.renderedCount = 0;
  const batchSize = Math.min(RENDER_PAGE_SIZE, tabs.length);
  appendGroupItems(view, groupKey, tabs, 0, batchSize);
  view.renderedCount = batchSize;
  updateLoadMore(view, groupKey, tabs);
}

/** Appends the next page of tab items to a group's list element. */
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

/** Builds a new GroupView (DOM card with header, action buttons, and drag-drop handlers). */
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
  };
}

/** Extracts the creation timestamp from a group key (format: `<windowId>-<timestamp>-<nonce>`). */
function parseGroupCreationTime(key: string): number | null {
  const parts = key.split('-');
  if (parts.length < 3) return null;
  const timestamp = Number(parts[1]);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

/** Trims and lowercases a search query for case-insensitive matching. */
function normalizeSearchTerm(value: string): string {
  return value.trim().toLowerCase();
}

/** Filters a tab array to only those whose title or URL contains the search term. */
function filterGroupTabs(tabs: SavedTab[], searchTerm: string): SavedTab[] {
  if (!searchTerm) return tabs;
  return tabs.filter((tab) => {
    const title = tab.title.toLowerCase();
    const url = tab.url.toLowerCase();
    return title.includes(searchTerm) || url.includes(searchTerm);
  });
}

/** Updates the empty-state label to indicate either "no saved tabs" or "no matching tabs". */
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

/** Returns group keys sorted newest-first by creation timestamp. */
function getSortedGroupKeys(): string[] {
  return state.indexedGroupKeys
    .slice()
    .sort((a, b) => (parseGroupCreationTime(b) ?? 0) - (parseGroupCreationTime(a) ?? 0));
}

/** Returns true if the group's tab array has been loaded from storage. */
function isGroupLoaded(groupKey: string): boolean {
  return Object.hasOwn(state.currentGroups, groupKey);
}

/** Adds a group key to the indexed set if not already present. */
function upsertIndexedGroupKey(groupKey: string): void {
  if (state.indexedGroupKeySet.has(groupKey)) return;
  state.indexedGroupKeys.push(groupKey);
  state.indexedGroupKeySet.add(groupKey);
}

/** Removes a group key from the index and clears its cached data. */
function removeIndexedGroupKey(groupKey: string): void {
  if (!state.indexedGroupKeySet.has(groupKey)) return;
  state.indexedGroupKeys = state.indexedGroupKeys.filter((key) => key !== groupKey);
  state.indexedGroupKeySet.delete(groupKey);
  delete state.currentGroups[groupKey];
  delete state.visibleGroups[groupKey];
  state.groupLoadTasks.delete(groupKey);
}

/** Replaces the entire indexed key set, pruning stale groups from caches. */
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

/** Updates the in-memory group data after a group load or mutation and triggers a re-render. */
function applyLoadedGroup(groupKey: string, tabs: SavedTab[]): void {
  if (tabs.length > 0) {
    upsertIndexedGroupKey(groupKey);
    state.currentGroups[groupKey] = tabs;
  } else {
    removeIndexedGroupKey(groupKey);
  }
  scheduleRenderGroups();
}

/** Replaces all in-memory groups at once (used after full imports). */
function applyFullGroups(nextGroups: SavedTabGroups): void {
  const keys = Object.keys(nextGroups);
  setIndexedGroups(keys);
  state.currentGroups = cloneGroups(nextGroups);
  scheduleRenderGroups();
}

/** Returns the group's tabs, loading them from storage if necessary (deduped). */
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

/** Loads groups whose cards are near the viewport (or the first unloaded group as fallback). */
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

/** Schedules a viewport-based group load on the next animation frame. */
function scheduleViewportGroupLoad(): void {
  if (state.activeSearchTerm) return;
  if (state.viewportLoadFrame) return;
  state.viewportLoadFrame = window.requestAnimationFrame(() => {
    state.viewportLoadFrame = 0;
    runAsyncTask(loadGroupsNearViewport(), 'Failed to load groups for viewport');
  });
}

/** Sequentially loads all groups from storage for search filtering, aborting if the token changes. */
async function loadGroupsForSearch(loadToken: number): Promise<void> {
  for (const groupKey of getSortedGroupKeys()) {
    if (loadToken !== state.searchLoadToken || !state.activeSearchTerm) return;
    if (isGroupLoaded(groupKey)) continue;
    await ensureGroupLoaded(groupKey);
  }
}

/** Increments the search load token and kicks off progressive group loading for search. */
function scheduleSearchGroupLoad(): void {
  if (!state.activeSearchTerm) return;
  state.searchLoadToken += 1;
  runAsyncTask(loadGroupsForSearch(state.searchLoadToken), 'Failed to load groups for search');
}

/** Sets the total saved-tab count displayed in the header. */
function setTabCount(count: number): void {
  state.totalTabCount = Math.max(0, count);
  if (!tabCountEl) return;
  tabCountEl.textContent = String(state.totalTabCount);
}

/** Increments or decrements the displayed tab count by the given delta. */
function adjustTabCount(delta: number): void {
  setTabCount(state.totalTabCount + delta);
}

/** Re-reads all groups from storage and recomputes the total tab count. */
async function refreshTotalTabCount(): Promise<void> {
  const savedGroups = await readSavedGroups();
  setTabCount(countTotalTabs(savedGroups));
}

/** Returns true when every indexed group key has been loaded from storage. */
function areAllIndexedGroupsLoaded(): boolean {
  return state.indexedGroupKeys.every((groupKey) => isGroupLoaded(groupKey));
}

/** Cancels any pending `renderGroups` requestAnimationFrame or fallback timer. */
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

/** Schedules a `renderGroups` call via rAF with a setTimeout fallback for tests. */
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

/**
 * Sets the collapsed state of a single group card.
 *
 * When `collapsed` is true the group's item list is hidden and the per-group
 * collapse toggle chevron rotates. When false the items become visible and,
 * if the group's tab payload has not been fetched yet, a lazy-load is kicked off.
 */
function setGroupCollapsed(groupKey: string, collapsed: boolean): void {
  const view = groupViews.get(groupKey);
  if (!view) return;

  // Synchronize the CSS class that drives the chevron rotation and item visibility.
  view.card.classList.toggle('is-collapsed', collapsed);
  view.itemsWrap.hidden = collapsed;

  // Update the per-group collapse toggle button's accessible label.
  const collapseLabel = collapsed ? 'Expand list' : 'Collapse list';
  view.collapseButton.setAttribute('aria-label', collapseLabel);
  view.collapseButton.setAttribute('title', collapseLabel);

  // If the group is being expanded and its tabs haven't been loaded yet, fetch them.
  if (!collapsed && !isGroupLoaded(groupKey)) {
    runAsyncTask(ensureGroupLoaded(groupKey), `Failed to load group (${groupKey})`);
  }
}

/**
 * Sets the collapsed state of every rendered group card at once.
 *
 * When `collapsed` is true all groups are collapsed; when false all are
 * expanded (triggering lazy-loads for any groups whose payloads haven't been
 * fetched yet). Updates the global state flag and refreshes the toggle-all
 * button's icon and label.
 *
 * @param collapsed - Whether every group should be collapsed.
 */
function setAllGroupsCollapsed(collapsed: boolean): void {
  for (const groupKey of groupViews.keys()) {
    setGroupCollapsed(groupKey, collapsed);
  }
  state.allGroupsCollapsed = collapsed;
  updateToggleCollapseAllButton();
  updateScrollControls();
}

/**
 * Toggles between collapsing all and expanding all groups.
 *
 * Called when the user clicks the collapse-all button in the navbar.
 */
function toggleAllGroups(): void {
  setAllGroupsCollapsed(!state.allGroupsCollapsed);
}

/**
 * Re-derives `state.allGroupsCollapsed` from the actual DOM state of every
 * rendered group card.
 *
 * Called whenever a single group is individually toggled so the navbar button
 * stays in sync.
 */
function syncAllGroupsCollapsedState(): void {
  if (groupViews.size === 0) {
    state.allGroupsCollapsed = false;
  } else {
    // All groups collapsed only when every card carries the `is-collapsed` class.
    state.allGroupsCollapsed = Array.from(groupViews.values()).every((view) =>
      view.card.classList.contains('is-collapsed'),
    );
  }
  updateToggleCollapseAllButton();
}

/**
 * Updates the collapse-all navbar button's CSS class, aria-label, and title
 * to reflect whether all groups are currently collapsed or expanded.
 *
 * When collapsed the double-chevron icon rotates 180° via CSS to point down,
 * visually indicating "expand all".
 */
function updateToggleCollapseAllButton(): void {
  if (!toggleCollapseAllEl) return;
  toggleCollapseAllEl.classList.toggle('is-all-collapsed', state.allGroupsCollapsed);
  const label = state.allGroupsCollapsed ? 'Expand all groups' : 'Collapse all groups';
  toggleCollapseAllEl.setAttribute('aria-label', label);
  toggleCollapseAllEl.setAttribute('title', label);
}

/**
 * Applies the default collapse behavior on first render: collapses every group
 * except the first one in the sorted list (the most recent).
 *
 * This keeps the page compact on initial load while still showing the newest
 * group's tabs immediately.
 *
 * @param sortedGroupKeys - Group keys already sorted newest-first.
 */
function applyDefaultCollapse(sortedGroupKeys: string[]): void {
  state.initialCollapseApplied = true;

  // Only one group (or none) — nothing to collapse.
  if (sortedGroupKeys.length <= 1) return;

  // Collapse every group except the first (most recent).
  for (let i = 1; i < sortedGroupKeys.length; i++) {
    const groupKey = sortedGroupKeys[i];
    if (groupKey) {
      setGroupCollapsed(groupKey, true);
    }
  }

  // Derivation: not *all* groups are collapsed because the first one stays open.
  state.allGroupsCollapsed = false;
}

/** Diffs current state against the DOM, reconciles group cards, and triggers lazy loading. */
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

  for (const entry of entries) {
    const { groupKey, createdAt, loaded, tabs, visibleTabs } = entry;
    let view = groupViews.get(groupKey);
    if (!view) {
      view = createGroupView(groupKey);
      groupViews.set(groupKey, view);
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

    fragment.appendChild(view.card);
  }

  // On the very first render with multiple groups, collapse all except the most
  // recent one so the page is not overwhelmed with open cards. Must run before
  // replaceChildren so that the itemsWrap.hidden check below picks up the class.
  if (!state.initialCollapseApplied && entries.length > 0) {
    applyDefaultCollapse(entries.map((e) => e.groupKey));
  }

  // Sync each card's item visibility with its collapsed class.
  // Done after applyDefaultCollapse so the initial collapse is reflected.
  for (const entry of entries) {
    const view = groupViews.get(entry.groupKey);
    if (view) {
      view.itemsWrap.hidden = view.card.classList.contains('is-collapsed');
    }
  }

  groupsEl.replaceChildren(fragment);
  state.visibleGroups = nextVisibleGroups;

  updateScrollControls();
  updateToggleCollapseAllButton();

  if (!state.activeSearchTerm) {
    scheduleViewportGroupLoad();
  }
}

/** Reloads the index and optionally invalidates specific groups, then re-renders. */
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

/** Delegated click handler for all group-card buttons (collapse, restore, delete, load more). */
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
      if (!isCollapsed && !isGroupLoaded(groupKey)) {
        runAsyncTask(ensureGroupLoaded(groupKey), `Failed to load group (${groupKey})`);
      }
      // Sync the global collapse state after a single group is toggled.
      syncAllGroupsCollapsedState();
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

/** Opens a single saved tab in the browser and removes it from its group. */
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

/** Removes a single tab from its group without restoring it. */
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

/** Restores all tabs in a group to browser windows and removes the group from storage. */
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

/** Deletes an entire group of tabs from storage without restoring any of them. */
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

/** One-time cleanup action that removes duplicate URLs globally, keeping the newest saved instance. */
async function mergeDuplicatesOnce(): Promise<void> {
  const savedGroups = await readSavedGroups();
  const sortedGroupKeys = Object.keys(savedGroups).sort(
    (a, b) => (parseGroupCreationTime(b) ?? 0) - (parseGroupCreationTime(a) ?? 0),
  );
  const seenUrls = new Set<string>();
  const dedupedGroups: SavedTabGroups = {};
  let removedCount = 0;

  // Traverse newest-first by group creation time so first-seen URLs are the winners.
  for (const groupKey of sortedGroupKeys) {
    const tabs = savedGroups[groupKey] ?? [];
    const keptTabs: SavedTab[] = [];
    // Preserve original in-group order while removing global URL duplicates.
    for (const tab of tabs) {
      if (seenUrls.has(tab.url)) {
        removedCount += 1;
        continue;
      }
      seenUrls.add(tab.url);
      keptTabs.push(tab);
    }
    if (keptTabs.length > 0) {
      dedupedGroups[groupKey] = keptTabs;
    }
  }

  if (removedCount === 0) {
    setStatus('No duplicates found.');
    return;
  }

  const confirmed = window.confirm(
    `Merge duplicates? This will remove ${removedCount} duplicate tab${removedCount === 1 ? '' : 's'}.`,
  );
  if (!confirmed) {
    setStatus('Merge duplicates canceled.');
    return;
  }

  const saved = await writeSavedGroups(dedupedGroups);
  if (!saved) {
    setStatus('Failed to merge duplicates.');
    await refreshList();
    return;
  }
  applyFullGroups(dedupedGroups);
  setTabCount(countTotalTabs(dedupedGroups));
  setStatus(`Removed ${removedCount} duplicate tab${removedCount === 1 ? '' : 's'}.`);
}


/** Moves a dragged tab from its source group into the target group (drag-and-drop handler). */
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

/** Serializes all saved tabs to JSON, copies to clipboard, and downloads a backup file. */
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

  if (!copied && !downloaded) {
    setStatus('Export failed: Could not copy to clipboard or download file.');
    return;
  }

  const extras = [copied ? 'copied' : null, downloaded ? 'downloaded' : null].filter(Boolean).join(', ');
  setStatus(`Exported ${total} tab${total === 1 ? '' : 's'}${extras ? ` (${extras})` : ''}.`);
}

/** Parses JSON text and imports tabs in append or replace mode. */
async function importJsonText(text: string, mode: 'append' | 'replace'): Promise<void> {
  try {
    const settings = await readSettings();
    const parsed = JSON.parse(text);
    const windowId = await getCurrentWindowId();
    const fallbackKey = createCondenseGroupKey(windowId);
    const normalized = normalizeImportedGroups(parsed, fallbackKey);
    if (!normalized) {
      setStatus('Import failed: JSON structure not recognized.');
      return;
    }
    const existing = mode === 'replace' ? {} : await readSavedGroups();
    const nextGroups =
      mode === 'replace'
        ? mergeGroups({}, normalized, settings.duplicateTabsPolicy)
        : mergeGroups(existing, normalized, settings.duplicateTabsPolicy);
    const importedCount = countTotalTabs(nextGroups) - countTotalTabs(existing);
    const saved = await writeSavedGroups(nextGroups);
    if (!saved) {
      setStatus('Import failed: Could not save tabs to storage.');
      await refreshList();
      return;
    }
    applyFullGroups(nextGroups);
    setTabCount(countTotalTabs(nextGroups));
    setStatus(`Successfully imported ${importedCount} tab${importedCount === 1 ? '' : 's'}.`);
  } catch (error) {
    logExtensionError('Failed to import JSON payload', error, { operation: 'runtime_context' });
    setStatus('Import failed: Invalid JSON format.');
  }
}

/** Imports tabs from the IO textarea in append mode. */
async function importJson(): Promise<void> {
  if (!jsonAreaEl) return;
  await importJsonText(jsonAreaEl.value, 'append');
}

/** Imports tabs from the IO textarea in replace mode (overwrites existing data). */
async function importJsonReplace(): Promise<void> {
  if (!jsonAreaEl) return;
  await importJsonText(jsonAreaEl.value, 'replace');
}

/** Reads a JSON file selected via the file input and imports its tabs. */
async function importJsonFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    if (jsonAreaEl) jsonAreaEl.value = text;
    await importJsonText(text, 'append');
  } catch (error) {
    logExtensionError('Failed to import JSON file', error, { operation: 'runtime_context' });
    setStatus('Import failed: Could not read the selected file.');
  }
}

/** Returns the window ID of the current tab, or undefined if unavailable. */
async function getCurrentWindowId(): Promise<number | undefined> {
  try {
    const currentTab = await chrome.tabs.getCurrent();
    if (currentTab && typeof currentTab.windowId === 'number') {
      return currentTab.windowId;
    }
  } catch (error) {
    logExtensionError('Failed to get current window id', error, { operation: 'tab_query' });
    // ignore
  }
  return undefined;
}

/** Parses OneTab export text from the IO textarea and appends the resulting tabs. */
async function importOneTab(): Promise<void> {
  if (!jsonAreaEl) return;
  const settings = await readSettings();
  const text = jsonAreaEl.value;
  const { tabs: imported, totalLines } = parseOneTabExport(text);
  const skipped = Math.max(0, totalLines - imported.length);
  if (imported.length === 0) {
    setStatus('No valid OneTab links found to import.');
    return;
  }
  const windowId = await getCurrentWindowId();
  const groupKey = createCondenseGroupKey(windowId);
  const existing = state.indexedGroupKeySet.has(groupKey) ? await ensureGroupLoaded(groupKey) : [];
  let mergeResult: { tabs: SavedTab[]; addedCount: number };
  if (settings.duplicateTabsPolicy === 'reject') {
    const savedGroups = await readSavedGroups();
    mergeResult = appendTabsByDuplicatePolicy(existing, imported, 'reject', collectSavedTabUrls(savedGroups));
  } else {
    mergeResult = appendTabsByDuplicatePolicy(existing, imported, 'allow');
  }
  const { tabs: updatedGroup, addedCount } = mergeResult;
  if (addedCount === 0) {
    setStatus('No new OneTab links found to import.');
    return;
  }
  const saved = await writeSavedGroup(groupKey, updatedGroup);
  if (!saved) {
    setStatus('Import failed: Could not save tabs to storage.');
    await refreshList();
    return;
  }
  upsertIndexedGroupKey(groupKey);
  state.currentGroups[groupKey] = updatedGroup;
  scheduleRenderGroups();
  adjustTabCount(addedCount);
  const skippedMsg = skipped > 0 ? ` (skipped ${skipped} invalid lines)` : '';
  setStatus(`Successfully imported ${addedCount} tab${addedCount === 1 ? '' : 's'}${skippedMsg}.`);
}

/** Initializes the list page: loads data, binds all event listeners, and starts lazy loading. */
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

  // Wire the collapse/expand-all toggle button.
  toggleCollapseAllEl?.addEventListener('click', () => {
    toggleAllGroups();
  });
  mergeDuplicatesEl?.addEventListener('click', () => {
    runAsyncTask(mergeDuplicatesOnce(), 'Failed to merge duplicates');
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

/** Returns the scroll offset for the bottom of the list section (used by "scroll to bottom"). */
function getListBottomScrollTarget(): number {
  if (!listSectionEl) return 0;
  const rect = listSectionEl.getBoundingClientRect();
  const listBottom = rect.bottom + window.scrollY;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const target = Math.max(0, listBottom - window.innerHeight + 16);
  return Math.min(target, maxScroll);
}

/** Schedules scroll control visibility update on the next animation frame. */
function scheduleScrollControlsUpdate(): void {
  if (state.scrollUpdateFrame) return;
  state.scrollUpdateFrame = window.requestAnimationFrame(() => {
    state.scrollUpdateFrame = 0;
    updateScrollControls();
  });
}

/** Enables/disables the scroll-to-top and scroll-to-bottom buttons based on scroll position. */
function updateScrollControls(): void {
  if (!scrollTopEl || !scrollBottomEl) return;
  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const hasOverflow = maxScroll > 8;
  const nearTop = window.scrollY < 24;
  const bottomTarget = getListBottomScrollTarget();
  const nearBottom = window.scrollY >= bottomTarget - 24;

  // Scroll buttons stay visible at all times to prevent layout shifts in the
  // navbar; they are simply disabled when scrolling is not possible.
  scrollTopEl.classList.toggle('is-disabled', !hasOverflow || nearTop);
  scrollBottomEl.classList.toggle('is-disabled', !hasOverflow || nearBottom);
}
