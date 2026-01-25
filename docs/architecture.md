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
- Manages settings like “Exclude pinned tabs” and “Tabs per restore window”.

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

## Why groups exist
Each “condense” action creates a **group** of tabs. The group is keyed by the
current `windowId` (stringified). This keeps the UI organized and makes “Restore all”
behavior predictable (a group roughly represents “the tabs that were open together”).

## Restore behavior

### Restore single
- Opens the tab in the current window (the one that contains the list UI).
- Removes the tab from storage immediately.

### Restore group (restore all)
- Uses `restoreBatchSize` from settings to create **one window per chunk**.
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

## Future changes
If you add new features:
- Keep background logic small and offload UI to the list page.
- Update `docs/storage.md` if the schema changes.
- Add any new permissions to `README.md` with rationale.
