# spec.md - nufftabs (WXT)

Enough tabs. Condense tabs into a grouped list, then restore them later.

This spec describes the current shipped behavior and serves as a reference for future changes.

---

## 0) One sentence product definition

**nufftabs** is a minimal MV3 Chrome extension that saves all tabs from the current window into a grouped list and closes them, then lets you restore a single tab in the current window or restore a group into new windows while removing restored tabs from the list.

---

## 1) Constraints

### 1.1 Tooling
- Project is bootstrapped using **WXT** (Web Extension Toolkit).
- Do not create/maintain a source `manifest.json`; configure manifest via `wxt.config.ts`.
- Use WXT entrypoints for background, list UI, and options UI.

### 1.2 Supported browsers
- Primary target: Chrome (MV3).
- Firefox builds exist for linting (`pnpm lint:webext`) but are not the main target.

### 1.3 Storage and permissions
- Persist saved tabs and settings via `chrome.storage.local`.
- Only required permissions:
  - `tabs`
  - `storage`

### 1.4 UI and UX goals
- Functional > pretty.
- A single options UI page is enough for all settings.

---

## 2) Functional requirements

### 2.1 "Condense" (primary action)
Triggered by clicking the extension action icon.

**Behavior**
1. Query all tabs in the current window.
2. Apply settings:
   - If Exclude pinned tabs is ON: do not save pinned tabs; do not close pinned tabs.
   - If OFF: pinned tabs are treated like normal tabs.
3. Save eligible tabs into a new group in storage.
4. Close eligible tabs.
5. Focus an existing list UI tab if one exists (most recently active); otherwise create a new list UI tab and pin it.

**Eligible tab definition**
- Must have a non-empty URL (uses `tab.url` or `tab.pendingUrl`).
- The list UI tab itself is excluded.

**Data captured per saved tab**
- `id`: string UUID
- `url`: string
- `title`: string (fallback: url)
- `savedAt`: number (epoch ms)

### 2.2 List UI (nufftabs page)
The list UI lives at `/nufftabs.html` and renders grouped saved tabs.

Per-group actions:
- Restore all
- Delete all

Per-tab actions:
- Restore single
- Delete single

Global tools:
- Export JSON
- Import JSON (append)
- Import JSON (replace)
- Import file (JSON)
- Import OneTab

The UI refreshes on storage changes and when the tab becomes visible again.

### 2.3 Restore single (current window + remove from list)
When user clicks Restore on a tab:
1. Open the tab in the current window (the one containing the list UI).
2. If the current window is unavailable, fall back to a new window.
3. If Save memory when restoring tabs is enabled, discard the restored tab after its URL is set (best-effort).
4. Remove that item from stored list immediately.
5. Re-render UI reflecting removal.

### 2.4 Restore group (chunked windows + remove group)
When user clicks Restore all on a group:
1. If the group is empty: do nothing (optional status message).
2. Split tabs into chunks using `restoreBatchSize`.
3. If the list tab is the only tab in its window, reuse that window for the first chunk.
4. Otherwise, create a new window for each chunk.
5. Create remaining tabs in each window.
6. If Save memory when restoring tabs is enabled, discard restored tabs after their URLs are set (best-effort).
7. Delete the group from storage.
8. Re-render UI showing the updated state.

### 2.5 Delete group
When user clicks Delete all on a group:
- Remove the group from storage.
- Re-render UI.

### 2.6 Export / Import JSON
**Export JSON**
- Produces JSON into a textarea.
- Format: `{ "savedTabs": { "<groupKey>": [...] } }`
- Pretty-print (2 spaces).
- Attempts to copy to clipboard and downloads a backup file.

**Import JSON (append or replace)**
- Reads JSON from textarea.
- Accepts:
  - array of tabs
  - object with `savedTabs`
  - grouped object keyed by group id
- Minimal validation:
  - each entry must contain a string `url`
  - if missing `id`, generate UUID
  - if missing `title`, set to url
  - if missing `savedAt`, set to now
- Append merges into existing groups; Replace swaps the whole dataset.
- On invalid JSON, show a clear error message.

### 2.7 Import file (JSON)
- Reads a local `.json` file and appends the parsed tabs to existing groups.

### 2.8 Import OneTab
- Accepts OneTab export lines formatted as `URL | Title`.
- Filters to allowed schemes and appends to the current group.

---

## 3) Settings

### 3.1 Exclude pinned tabs
- Name: `excludePinned`
- Type: boolean
- Default: `true`
- UI: checkbox in the Options page
- Storage: `chrome.storage.local` under a `settings` object

### 3.2 Tabs per restore window
- Name: `restoreBatchSize`
- Type: number
- Default: `100`
- UI: number input in the Options page (blank = default)
- Behavior: controls how many tabs open per window during Restore all

### 3.3 Save memory when restoring tabs
- Name: `discardRestoredTabs`
- Type: boolean
- Default: `false`
- UI: radio group in the Options page (Disabled/Enabled)
- Behavior: if enabled, restored tabs are discarded after their URLs are set (best-effort) and load on click
- If turned off mid-restore, any pending discards are skipped

---

## 4) Data model and storage keys

### 4.1 Storage keys
- `savedTabsIndex`: `string[]` of active group keys
- `savedTabs:<groupKey>`: `SavedTab[]`
- `settings`: `{ excludePinned: boolean, restoreBatchSize: number, discardRestoredTabs: boolean }`

### 4.2 Types
```ts
type SavedTab = {
  id: string;       // UUID
  url: string;
  title: string;
  savedAt: number;  // epoch ms
};

type Settings = {
  excludePinned: boolean;
  restoreBatchSize: number;
  discardRestoredTabs: boolean;
};
```

### 4.3 Group keys
`groupKey` is `windowId-epochMs-uuid` (or `unknown-epochMs-uuid`), so each condense creates a fresh group.

---

## 5) WXT structure (expected files)

### 5.1 Background service worker
- `entrypoints/background/index.ts`
  - listens to `chrome.action.onClicked`
  - implements Condense
  - saves groups + closes tabs
  - focuses or creates the list UI tab

### 5.2 List UI
- `entrypoints/nufftabs/index.html`
- `entrypoints/nufftabs/index.ts`
- `entrypoints/nufftabs/style.css`

### 5.3 Options UI
- `entrypoints/options/index.html`
- `entrypoints/options/index.ts`
- `entrypoints/options/style.css`

### 5.4 WXT config
- `wxt.config.ts`
  - `manifest.permissions = ["tabs", "storage"]`
  - `manifest.action.default_title = "Condense tabs"`
  - `manifest.options_ui.page = "options.html"`

---

## 6) Manual acceptance checklist (current behavior)

### A. Condense
1. Open 5 tabs.
2. Click action icon.
3. Tabs close; list UI shows a new group with 5 items.

### B. Exclude pinned
1. Open 4 tabs; pin 2.
2. Exclude pinned ON.
3. Condense.
4. Pinned remain, 2 saved.
5. Turn OFF; open 2 tabs and pin 1; condense.
6. All eligible tabs including pinned are saved and closed.

### C. Restore single removes it
1. Click Restore on one item.
2. The tab opens in the current window.
3. The item disappears from the group.

### D. Restore all clears group and opens windows
1. Click Restore all on a group.
2. New window(s) open for the restored tabs (based on restore batch size).
3. The group disappears from the list.

### E. Delete all (per group)
1. Condense again.
2. Delete all on a group.
3. The group disappears.

### F. Export/Import
1. Condense 3 tabs.
2. Export JSON; confirm textarea contains JSON and a download occurs.
3. Delete the group.
4. Import JSON (append or replace).
5. List repopulates with the same URLs.
6. Import invalid JSON -> status shows error and list unchanged.

### G. Save memory on restore
1. Enable Save memory when restoring tabs.
2. Restore all and confirm tabs appear but load on click.
3. Restore single and confirm it is discarded until clicked.

---

## 7) Done definition
Project is done when:
- All acceptance checks pass
- No extra permissions exist beyond `tabs` + `storage`
- No extension errors in Chrome Extensions page
- Code is small, readable, and behavior matches this spec
