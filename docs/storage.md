# Storage design (nufftabs)

This document explains how nufftabs stores data, why the layout looks the way it does,
and how to safely read/write it. It is written for a junior developer who wants to
understand the decisions and avoid common pitfalls.

## Goals and constraints
- **Fast for large lists:** avoid rewriting a giant object every time a single tab is
  added or removed.
- **Simple to reason about:** minimal schema and a single source of truth.
- **Only `chrome.storage.local`:** no sync requirements for saved tabs.
- **No legacy migration:** the extension has not shipped yet, so we can assume a clean
  schema from day one.

## Storage keys
All data lives in `chrome.storage.local`.

### 1) Index of groups
```
savedTabsIndex: string[]
```
This is the list of active group keys. It is the canonical list used to discover
groups on read.

### 2) Per‑group entries
```
savedTabs:<groupKey>: SavedTab[]
```
Each group is stored under its own key. This prevents large rewrites and allows
single‑group updates.

### 3) Settings
```
settings: {
  excludePinned: boolean;
  restoreBatchSize: number;
}
```
Settings are stored locally (not sync) for simplicity and to avoid conflicts.

## Data model

### SavedTab
```
type SavedTab = {
  id: string;      // UUID (crypto.randomUUID)
  url: string;     // non-empty
  title: string;   // fallback to url
  savedAt: number; // epoch ms
};
```

### Group key
`groupKey` is currently the **stringified window ID** at the time of condense.
This is not a permanent identifier (window IDs can be reused), but it is stable
enough for "save tabs from this window now".

## Read flow
1. Read `savedTabsIndex`.
2. For each group key, read `savedTabs:<groupKey>`.
3. Normalize each list (drop invalid entries).
4. Assemble `SavedTabGroups` in memory.

## Write flows

### Write a single group
`writeSavedGroup(groupKey, tabs)`:
- If `tabs.length > 0`:
  - Ensure `groupKey` is present in `savedTabsIndex`.
  - Write `savedTabs:<groupKey>` with the array.
- If `tabs.length === 0`:
  - Remove `savedTabs:<groupKey>`.
  - Remove `groupKey` from `savedTabsIndex`.

### Write all groups
`writeSavedGroups(savedTabs)`:
- Rebuild `savedTabsIndex` from the object keys.
- Write each `savedTabs:<groupKey>` entry.
- Remove entries for groups that no longer exist.

This is used for bulk imports and replacement flows.

## Why per‑group storage?
Previously, a single `savedTabs` object held all groups. That meant every update
rewrote the entire dataset, which is slow for large lists and expensive on storage.
The index+group layout makes the common operations (`restoreSingle`, `deleteSingle`,
`condense`) fast and proportional to one group.

## Validation / normalization
Inputs are normalized:
- Non‑array values become empty arrays.
- Entries without a string `url` are dropped.
- `savedAt` must be a finite number; otherwise it defaults to `Date.now()`.

This keeps the UI stable even if storage is manually edited.

## Important gotchas
- **No sync:** tab data is local only; it will not appear on other devices.
- **Group keys can repeat:** window IDs can be reused across time; do not treat
  `groupKey` as a permanent identity.
- **Shallow cloning:** callers must replace arrays rather than mutating them in place.

## Adding fields later
If you need to add fields:
1. Update the `SavedTab` type in `entrypoints/shared/storage.ts`.
2. Update `createSavedTab(...)` to set defaults.
3. Update normalization to tolerate missing/unknown fields.
4. Update any export/import logic that serializes tabs.

## Useful file references
- `entrypoints/shared/storage.ts` — schema, normalization, read/write helpers.
- `entrypoints/background/index.ts` — condense writes a single group.
- `entrypoints/nufftabs/index.ts` — restore/delete/import flows.
