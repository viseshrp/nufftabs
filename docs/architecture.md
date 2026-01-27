# Architecture overview (nufftabs)

This document explains how the extension is structured, how data flows through it,
and why certain design choices were made. It is intended to be approachable for
junior developers and useful for future maintenance.

## High‑level components

1) **Background service worker** (`entrypoints/background/index.ts`)
- Listens for the extension action click.
- Queries tabs in the current window.
- Applies settings (exclude pinned).
- Saves eligible tabs to storage.
- Closes eligible tabs.
- Focuses (or creates) the list UI tab.

2) **List UI (nufftabs page)** (`entrypoints/nufftabs/`)
- Renders saved groups and tabs.
- Provides actions: restore single, restore group, delete group.
- Provides import/export tools.
- Listens to storage changes to refresh the view.

3) **Options page** (`entrypoints/options/`)
- Manages settings like Exclude pinned tabs, Tabs per restore window, and
  Save memory when restoring tabs.

## Data flow summary

```
User clicks action icon
  → Background reads settings
  → Background queries tabs in current window
  → Background filters tabs and saves a group
  → Background closes eligible tabs
  → Background focuses or creates list UI tab

List UI loads
  → Reads saved groups
  → Renders groups + tabs
  → User restores/deletes/imports
  → UI writes updated groups back to storage
  → Storage change listener refreshes UI
```

## Key flows (pseudo-code)

### Condense (background)
```
settings = readSettings()
tabs = queryTabs(currentWindow)
eligible = tabs.filter(url is valid and (excludePinned ? !pinned : true) and not listUrl)
groupKey = String(windowId) or "unknown"
saved = readSavedGroup(groupKey)
saved = createSavedTab(eligible) + saved
writeSavedGroup(groupKey, saved)
close eligible tabs
focus or create list tab
```

### Restore single (list UI)
```
tabs = currentGroups[groupKey]
tab = tabs.find(id)
open tab in current window (or new window if needed)
if discardRestoredTabs: discard restored tab after URL set (best-effort)
tabs = tabs.filter(id)
writeSavedGroup(groupKey, tabs)
render UI
```

### Restore all (list UI)
```
tabs = currentGroups[groupKey]
chunks = split(tabs, restoreBatchSize)
if list tab is only tab in window:
  use current window for first chunk
else:
  create new window for each chunk
if discardRestoredTabs: discard restored tabs after URL set (best-effort)
writeSavedGroup(groupKey, [])  // delete group
render UI
```

### Import JSON
```
parsed = JSON.parse(text)
normalized = normalizeImportedGroups(parsed)
nextGroups = mode === replace ? normalized : mergeGroups(currentGroups, normalized)
writeSavedGroups(nextGroups)
render UI
```

### Import OneTab
```
lines = text.split("\n")
tabs = parseOneTab(lines)
groupKey = current window id
existing = currentGroups[groupKey]
writeSavedGroup(groupKey, existing + tabs)
render UI
```

## Why groups exist
Each “condense” action creates a **group** of tabs. The group is keyed by the
current `windowId` (stringified). This keeps the UI organized and makes “Restore all”
behavior predictable (a group roughly represents “the tabs that were open together”).

## Restore behavior

### Restore single
- Opens the tab in the current window (the one that contains the list UI).
- If Save memory when restoring tabs is enabled, the restored tab is discarded
  after its URL is set (best-effort) and loads on demand.
- Removes the tab from storage immediately.

### Restore group (restore all)
- Uses `restoreBatchSize` from settings to create **one window per chunk**.
- If Save memory when restoring tabs is enabled, restored tabs are discarded
  after their URLs are set (best-effort) and load on click.
- If the setting is turned off mid-restore, pending discards are skipped.
- If the list tab is the only tab in its window, it **reuses** that window for the
  first chunk and keeps the list tab pinned and active.
## Performance decisions (and tradeoffs)

These choices keep the UI responsive with large tab counts:

- **Incremental rendering:** only the first `RENDER_PAGE_SIZE` tabs render initially.
  The rest require “Load more”. This keeps DOM size bounded.
- **Heuristic group diffing:** group updates are detected by checking first/middle/last
  tab IDs instead of deep comparisons. This can miss reorder changes.
- **Event delegation:** one click handler on the list container replaces per‑row listeners.
  This is faster but depends on `data-action` attributes.
- **Concurrency‑limited restore:** tabs are created in small parallel batches. This
  improves throughput but can relax strict ordering.

## UI rendering model
The list UI holds an in‑memory `currentGroups` object and updates the DOM when:
- The page loads.
- Storage changes (e.g., background condense or another tab).
- The page becomes visible again.

Groups are rendered as cards. Each group can be collapsed without deleting data.

## UI behavior reference
- **Collapse group:** hides rows but does not delete data.
- **Restore all:** restores all tabs in the group, then deletes the group.
- **Delete all:** deletes the entire group without opening tabs.
- **Restore single:** opens one tab, then removes it from the group.
- **Save memory on restore:** when enabled, restored tabs are discarded
  after their URLs are set (best-effort) and load when clicked.
- **Save memory on restore (toggle off):** pending discards are skipped when the setting is turned off mid-restore.
- **Export JSON:** writes `{ savedTabs: ... }` to the textarea and downloads it.
- **Import JSON:** validates and appends (or replaces) groups.
- **Import OneTab:** parses OneTab text and appends to current group.
- **Load more:** renders the next chunk of rows for large groups.

## Storage schema
For the full schema and reasoning, see `docs/storage.md`.

## Common extension flows

### Condense
1. User clicks extension icon.
2. Background reads settings.
3. Background writes one group to storage.
4. Background closes eligible tabs.
5. Background focuses list tab.

### Import JSON
1. UI parses JSON.
2. UI normalizes tab entries (creates UUIDs, fills missing fields).
3. UI merges or replaces groups.
4. UI writes updated groups.

### Import OneTab
1. UI parses OneTab text lines.
2. UI filters by allowed URL schemes.
3. UI appends to current group.

## Where to look when debugging
- **Tabs not saved or closed:** `entrypoints/background/index.ts`
- **List UI not updating:** `entrypoints/nufftabs/index.ts`
- **Storage format issues:** `entrypoints/shared/storage.ts`
- **Settings not respected:** `entrypoints/options/index.ts`

## Troubleshooting matrix
- **Condense closes tabs but list is empty:** storage write failed; check background console
  and verify `savedTabsIndex`/`savedTabs:<groupKey>` keys exist.
- **List UI doesn’t refresh:** check storage listener and `isSameGroup` heuristic.
- **Restore all opens many windows:** verify `restoreBatchSize` and list‑tab reuse logic.
- **Import JSON fails:** validate schema; ensure each entry has a string `url`.

## Glossary
- **Group:** a collection of tabs saved together (keyed by window ID string).
- **List tab:** the `nufftabs.html` page that shows saved tabs.
- **Chunk:** a batch of tabs restored into a single window (size = `restoreBatchSize`).
- **Restore batch size:** number of tabs to open per window during “Restore all”.
- **Index:** `savedTabsIndex`, the list of group keys in storage.

## Future changes
If you add new features:
- Keep background logic small and offload UI to the list page.
- Update `docs/storage.md` if the schema changes.
- Add any new permissions to `README.md` with rationale.
