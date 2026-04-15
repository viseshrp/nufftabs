# Storage design (nufftabs)

This document explains how nufftabs stores data, why the layout looks the way it does,
and how to safely read/write it. It is written for a junior developer who wants to
understand the decisions and avoid common pitfalls.

## Goals and constraints
- **Fast for large lists:** avoid rewriting a giant object every time a single tab is
  added or removed.
- **Simple to reason about:** physical group entries are the single source of truth.
- **Only `chrome.storage.local`:** no sync requirements for saved tabs.
- **Backward-compatible reads:** new code reads older aggregate metadata while writing
  the safer per-group layout.

## Storage keys
All data lives in `chrome.storage.local`.

### 1) Compatibility index of groups
```
savedTabsIndex: string[]
```
This mirrors active group keys for older tooling and debugging. New reads discover
groups from physical `savedTabs:<groupKey>` keys with `chrome.storage.local.getKeys()`,
so a stale index write cannot hide an unrelated group.

### 2) Per-group entries
```
savedTabs:<groupKey>: SavedTab[]
```
Each group is stored under its own key. This prevents large rewrites and allows
single-group updates.

### 3) Group metadata
```
savedTabGroupMetadata:<groupKey>: { pinned: true } | { pinned: false }
```
Each metadata entry is stored under its own group key. `{ pinned: true }` marks a
group as pinned. `{ pinned: false }` is a tombstone used to override older aggregate
metadata during migration; exported backups still omit unpinned groups.

The older aggregate key is still read as a fallback:
```
savedTabGroupMetadata: Record<string, { pinned: true }>
```
New writes avoid this shared map so concurrent pin toggles for different groups do
not overwrite each other.

### 4) Settings
```
settings: {
  excludePinned: boolean;
  restoreBatchSize: number;
  discardRestoredTabs: boolean;
  duplicateTabsPolicy: 'allow' | 'reject';
  theme: 'os' | 'light' | 'dark';
}
```
Settings are stored locally (not sync) for simplicity and to avoid conflicts.

### 5) Optional Drive backup metadata
```
driveInstallId: string
driveBackupIndex: {
  installId: string;
  backups: Array<{
    fileId: string;
    fileName: string;
    timestamp: number;
    size: number;
    tabGroupCount: number;
  }>;
}
driveRetentionCount: number
```
These keys support the manual Google Drive backup feature in options. They are local
cache/settings only; backup file contents remain in the user's Google Drive.

## Example storage snapshot
This is what storage might look like after two condense actions:

```
savedTabsIndex: ["123-1700000000000-uuid-a", "456-1700000001000-uuid-b"]
savedTabs:123-1700000000000-uuid-a: [
  { "id": "uuid-1", "url": "https://example.com", "title": "Example", "savedAt": 1737860000000 },
  { "id": "uuid-2", "url": "https://news.ycombinator.com", "title": "Hacker News", "savedAt": 1737860000000 }
]
savedTabs:456-1700000001000-uuid-b: [
  { "id": "uuid-3", "url": "https://openai.com", "title": "OpenAI", "savedAt": 1737860100000 }
]
savedTabGroupMetadata:123-1700000000000-uuid-a: { "pinned": true }
settings: { "excludePinned": true, "restoreBatchSize": 100, "discardRestoredTabs": false, "duplicateTabsPolicy": "allow", "theme": "os" }
driveInstallId: "0f8fad5b-d9cb-469f-a165-70867728950e"
driveRetentionCount: 10
driveBackupIndex: {
  "installId": "0f8fad5b-d9cb-469f-a165-70867728950e",
  "backups": [
    { "fileId": "1AbC...", "fileName": "nufftabs-backup-2026-02-19T20-10-45-120Z-g2.json", "timestamp": 1771531845120, "size": 1824, "tabGroupCount": 2 }
  ]
}
```

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
`groupKey` is `windowId-epochMs-uuid` (or `unknown-epochMs-uuid`), so each condense
creates a fresh group instead of appending to an existing one.

## Common write patterns (pseudo-code)

### Create a new group (condense)
```
tabs = newTabs
appendSavedGroup(groupKey, tabs)
```

### Remove a single tab
```
tabs = readSavedGroup(groupKey)
tabs = tabs.filter(t => t.id !== id)
writeSavedGroup(groupKey, tabs)
```

### Delete a whole group
```
writeSavedGroup(groupKey, [])
```

## Read flow
The extension uses two read patterns:

1. **Key-first UI pass (list page)**
   - Enumerate `savedTabs:<groupKey>` storage keys to discover active groups.
   - Read `savedTabGroupMetadata:<groupKey>` entries for pinned sorting and pin button state.
   - Render group cards/placeholders from keys.
   - Read `savedTabs:<groupKey>` on demand (viewport/search/expand).
2. **Full-read pass (imports/exports/total count refresh)**
   - Enumerate `savedTabs:<groupKey>` storage keys to discover active groups.
   - Read each `savedTabs:<groupKey>`.
   - Normalize each list (drop invalid entries).
   - Assemble `SavedTabGroups` in memory.

## Write flows

### Write a single group
`writeSavedGroup(groupKey, tabs)`:
- If `tabs.length > 0`:
  - Write `savedTabs:<groupKey>` with the array.
  - Update `savedTabsIndex` as a compatibility mirror.
- If `tabs.length === 0`:
  - Remove `savedTabs:<groupKey>`.
  - Remove `savedTabGroupMetadata:<groupKey>`.
  - Update `savedTabsIndex` as a compatibility mirror.

### Write all groups
`writeSavedGroups(savedTabs, groupMetadata?)`:
- Rebuild `savedTabsIndex` from the object keys.
- Write each `savedTabs:<groupKey>` entry.
- If explicit metadata is supplied, write per-group `savedTabGroupMetadata:<groupKey>`
  entries for active groups only.
- Remove tab and metadata entries for groups that no longer exist.

This is used for bulk imports and replacement flows.

### Pin or unpin a group
`writeSavedGroupPinned(groupKey, pinned)`:
- Enumerate `savedTabs:<groupKey>` keys to confirm the group still exists.
- Write exactly one metadata key: `savedTabGroupMetadata:<groupKey>`.
- Use `{ pinned: false }` for unpin so older aggregate metadata cannot re-pin the
  group on the next read.

This keeps the common pin toggle O(1) in write payload size and avoids rewriting a
shared metadata map from multiple open list pages.

## Why per-group storage?
A single monolithic `savedTabs` value would require rewriting the entire dataset on
small changes, which is slow for large lists. The key-enumeration + group layout makes common
operations (`restoreSingle`, `deleteSingle`, `condense`) fast and proportional to one group.
It also enables lazy data-fetch: the UI can render from group keys first and fetch group payloads
only when needed.

## Validation / normalization
Inputs are normalized:
- Non-array values become empty arrays.
- Entries without a string `url` are dropped.
- `savedAt` must be a finite number; otherwise it defaults to `Date.now()`.

This keeps the UI stable even if storage is manually edited.

## Important gotchas
- **No sync:** tab data is local only; it will not appear on other devices.
- **Group keys are not a stable window identity:** window IDs can be reused across time;
  do not treat `groupKey` as a permanent identity.
- **Shallow cloning:** callers must replace arrays rather than mutating them in place.

## Adding fields later
If you need to add fields:
1. Update the `SavedTab` type in `entrypoints/shared/storage.ts`.
2. Update `createSavedTab(...)` to set defaults.
3. Update normalization to tolerate missing/unknown fields.
4. Update any export/import logic that serializes tabs.

## Troubleshooting storage issues
- **Saved list empty after condense:** check that each `savedTabs:<groupKey>` exists
  and contains valid tab entries.
- **Group not showing in UI:** confirm the `savedTabs:<groupKey>` array contains
  valid objects with `url`.
- **Unexpected ordering:** check whether `savedAt` values are identical (same timestamp
  is used for all tabs in a condense action).

## Useful file references
- `entrypoints/shared/storage.ts` - schema, normalization, read/write helpers.
- `entrypoints/background/index.ts` - condense writes a single group.
- `entrypoints/nufftabs/index.ts` - restore/delete/import flows.
