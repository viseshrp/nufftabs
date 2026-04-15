# nufftabs

[![Codecov](https://codecov.io/gh/viseshrp/nufftabs/branch/main/graph/badge.svg)](https://codecov.io/gh/viseshrp/nufftabs)

nufftabs is a minimal Chrome (MV3) extension to condense all tabs from the current window into a saved list, then restore them later. It uses WXT for build/dev and stores saved tabs and settings in `chrome.storage.local`.

## Core features
- Condense tabs from the current window (optionally excluding pinned tabs).
- List UI grouped by condense action, with per-group restore all/delete all plus per-tab restore/delete.
- Pin saved tab groups so important groups stay above unpinned groups.
- Dynamic search in the fixed top bar filters tabs by title/URL.
- Drag-and-drop between groups to move a saved tab.
- Key-first lazy loading: group keys load first, group payloads load on demand.
- Export/import JSON (append or replace), import from file, and OneTab import.
- Restore rules: single restore uses the current window; restore all opens new windows per chunk, reusing the list window only when it is the sole tab.
- Safety guardrails: condense and restore mutate storage only after a successful verification step.
- List tab is pinned and reused if it already exists.
- Settings for “Exclude pinned tabs,” “Tabs per restore window,” duplicate handling, and optional memory-saving restore.
- Optional manual Google Drive backup/restore from the options page.

## How it works

### Condense
- Triggered by clicking the extension action icon.
- Reads settings (`excludePinned`, `restoreBatchSize`, `discardRestoredTabs`, `duplicateTabsPolicy`) from `chrome.storage.local`.
- Skips browser-internal URLs (`chrome://`, `chrome-extension://`, `chrome-search://`, `chrome-untrusted://`, `devtools://`, `about:`) so only user-content tabs are condensed.
- Saves eligible tabs (URL + title + timestamp) to a new group under `savedTabs:<groupKey>` and mirrors the key into `savedTabsIndex` for compatibility.
- Verifies the saved group can be read back with matching tab entries.
- Closes eligible tabs only after verification succeeds.
- Focuses an existing nufftabs list tab if one exists anywhere (most recently active), or creates a new one if none exist. The list tab is pinned.

### List page
- Unlisted page at `/nufftabs.html`.
- Enumerates `savedTabs:<groupKey>` keys and lightweight group metadata first, then loads group payloads on demand.
- Renders saved tab groups from `chrome.storage.local` and keeps the header count based on total saved tabs.
- Filters visible rows and groups from the top app-bar search input.
- Refreshes on storage changes and when the tab becomes visible.

### Performance tradeoffs (intentional)
To keep the list UI responsive with large tab counts, the code makes a few deliberate
tradeoffs. These are documented in code comments, but summarized here for maintainers:

- **Group diff heuristic:** group changes are detected by comparing the first, middle, and
  last tab IDs instead of a full deep comparison. This avoids O(n) checks but can miss
  reorders or mid-list edits, resulting in a skipped re-render.
- **Incremental list rendering:** only the first `RENDER_PAGE_SIZE` items render initially.
  Remaining tabs require a "Load more" click to render additional chunks. This bounds DOM
  size but means not all rows are immediately visible.
- **Key-first group loading:** the page enumerates `savedTabs:<groupKey>` keys first, then fetches each
  `savedTabs:<groupKey>` payload as needed (viewport/search/expand). This keeps first paint
  responsive, but initial renders can show loading placeholders for off-screen groups.
- **Event delegation:** a single click handler on the list container routes actions via
  `data-action`. This reduces per-row listeners, but action handling depends on markup and
  attributes staying in sync.
- **Concurrency-limited restore:** tab creation runs in parallel batches for speed. This
  can relax strict creation order compared to fully sequential creation.
- **Shallow group cloning:** `cloneGroups()` only shallow-copies the groups map. Callers
  must replace arrays rather than mutating them in place to avoid accidental shared state.

### Gotchas
- **Group key = window ID + timestamp + nonce.** Each condense creates a fresh group key like
  `${windowId}-${epochMs}-${uuid}` (or `unknown-...` when window ID is unavailable), so repeated
  condenses never append to earlier groups.
- **Created-at ordering.** Group "Created" timestamps use the earliest `savedAt` in the group.
  Imports (including OneTab) stamp `savedAt` with "now," which can make imported groups
  appear newest.
- **Restore order.** Concurrency-limited restore favors throughput; tab ordering can differ
  slightly from list order for large restores.
- **Paged rendering.** Large groups only render the first `RENDER_PAGE_SIZE` items until
  the user clicks "Load more," which can look like missing tabs.
- **Search semantics.** Search is case-insensitive substring matching over title + URL. It is
  intentionally not fuzzy, tokenized, or regex-based.
- **Local settings.** Settings are stored in `chrome.storage.local`, not sync, so they
  do not follow the user across machines.
- **List tab reuse.** Condense may focus an existing list tab in another window and pins it,
  which can feel surprising if multiple windows are open.

### Developer notes
- **Storage schema:** saved tabs are stored per group under `savedTabs:<groupKey>` with a
  `savedTabsIndex` compatibility mirror. Active groups are discovered from physical
  `savedTabs:<groupKey>` keys so stale index writes cannot hide unrelated groups.
  Pinned group state is stored separately under `savedTabGroupMetadata:<groupKey>` so
  pin toggles write one small key instead of a shared metadata map or tab payload.
- **Data shapes:** `SavedTab` requires a UUID `id`, non-empty `url`, `title`, and `savedAt`
  epoch ms. Settings are `{ excludePinned, restoreBatchSize, discardRestoredTabs, duplicateTabsPolicy, theme }`.
- **Restore chunking:** `restoreBatchSize` controls how many tabs open per window during
  "Restore all" (one window per chunk, after any reused list window).
- **Permissions:** `tabs`, `storage`, and `identity` are used.
- **Host permissions:** `https://www.googleapis.com/` is used only for optional manual Drive backup/restore.
- **WXT output:** dev builds live in `.output/chrome-mv3-dev/` and prod builds in
  `.output/chrome-mv3/`.

### Restore rules
- **Restore single:** always opens the tab in the current window (the window that contains the list tab) and keeps the list tab open and pinned.
- **Restore all:** opens new window(s) per restore chunk. If the list tab is the only tab in its window, the first chunk opens there and remaining chunks open in new windows (list tab remains open and active).
- **Save memory on restore:** when enabled, restored tabs are discarded after their URLs are set (best-effort) and will load when clicked.

## Development setup (WXT)

### Prerequisites
- Node.js
- pnpm

### Install
```bash
pnpm install
```

### Dev
```bash
pnpm dev
```

### Build
```bash
pnpm build
```

### Package (zip)
```bash
pnpm package
```

The packaged extension zip is generated under `.output/`.

## Load unpacked in Chrome
1. Run `pnpm dev` (or `pnpm build`).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the build output directory:
   - Dev: `.output/chrome-mv3-dev/`
   - Build: `.output/chrome-mv3/`

## Usage guide

### Condense
1. Open several tabs in a window.
2. Click the nufftabs action icon.
3. Eligible tabs are saved and closed.
4. The list tab is focused (existing or newly created).

### Restore single (current window)
1. On the list page, click the restore icon for a tab.
2. The tab opens in the **current window**.
3. nufftabs verifies the restore succeeded.
4. The list item is removed from storage only after verification.

### Search saved tabs
1. Type in the search input in the fixed top bar.
2. Matching is case-insensitive and checks both tab title and URL.
3. Group cards with no matches are hidden.
4. Matching groups show filtered counts (`x of y tabs`) and preserve all row/group actions.

### Large lists and lazy loading
- Group keys are enumerated first from `savedTabs:<groupKey>` storage entries.
- Group payloads are loaded when they are near the viewport, expanded, or needed by search.
- Within each visible group, rows are rendered in pages (`RENDER_PAGE_SIZE`) with **Load more**.
- Header tab count always reflects total saved tabs, not just loaded groups.

### Restore all (per group)
1. Click **Restore all** on a group card.
2. If the list tab is not the only tab in the window, a **new window** opens for each restore chunk.
3. If the list tab is the only tab, the first chunk restores **in the same window**, and the list tab stays open.
4. The saved group is removed from storage only after restore verification succeeds.

### Delete all (per group)
1. Click **Delete all** on a group card.
2. The selected group is removed.

### Merge duplicates (one-time)
1. Click **Merge duplicates** in the sticky top bar.
2. Confirm the prompt to remove duplicates globally across all groups.
3. nufftabs keeps the newest saved instance of each URL and removes older duplicates.

### Export / Import JSON
1. Click the Export/Import control to open the panel.
2. **Export** populates the JSON textarea, copies to clipboard (if allowed), and downloads a backup file.
3. **Import** appends the parsed tabs to existing groups.
4. **Import (replace)** reads the textarea and replaces the saved list if valid.
5. **Import file** reads a JSON file and appends the parsed tabs.
6. Existing groups keep their current collapse/expand state after import; newly added groups follow the current global mode (collapsed if **Collapse all** is active, otherwise expanded).

### Import from OneTab
1. In OneTab, open “Export / Import URLs” and copy the text.
2. Paste it into the nufftabs Import panel textarea.
3. Click **Import OneTab** to append those tabs to the current list.
4. Only `http`, `https`, and `file` URLs are imported. Other schemes (for example `chrome://`) are skipped.

### Exclude pinned tabs
1. Open the options page (Extension details ? “Extension options”).
2. Toggle **Exclude pinned tabs**.
3. When enabled, pinned tabs are not saved or closed during condense.

### Tabs per restore window
1. Open the options page.
2. Set **Tabs per restore window** (leave blank to use the default of 100).
3. During **Restore all**, each window opens up to that many tabs.

### Save memory on restore
1. Open the options page.
2. Set **Save memory when restoring tabs** to **Enabled**.
3. Restored tabs are unloaded after their URLs are set and will load when clicked.
4. If you turn the setting off, no discard scheduling runs (pending discards are skipped).

### Duplicate handling
1. Open the options page.
2. Set **Duplicates** to **Allow duplicates** or **Silently reject duplicates**.
3. When reject mode is enabled, condense and import flows skip URLs already saved in nufftabs.
4. During condense in reject mode, skipped duplicate tabs are left open in the source window.

### Existing list tab reuse
- If a list tab already exists anywhere, condense focuses the most recently active one.
- If none exists, a new list tab is created and pinned.

### Google Drive manual backup (optional)
1. Open the options page.
2. Click **Connect to Google Drive** and approve OAuth access.
3. The same button updates in place to show connection progress/state and acts as **Disconnect** when already connected.
4. Set **Retention** (how many backups to keep).
5. Click **Backup now** to upload a snapshot of saved tabs.
6. Use **Merge** on any listed backup row to append backup groups into your current tab lists, or use **Restore** to replace local saved tabs with that backup.

### Local OAuth setup for unpacked builds
If you see `bad client id` or auth failures in dev, your unpacked extension ID likely does
not match the OAuth client's configured Chrome Extension ID.
1. Set `CHROME_EXTENSION_KEY` (or `EXTENSION_MANIFEST_KEY`) to a fixed extension private key.
2. Set `GOOGLE_OAUTH_CLIENT_ID` to the OAuth client tied to that extension ID.
3. Restart `pnpm dev` (or rebuild + reload extension).

`wxt.config.ts` uses these env vars so your local extension ID remains stable and matches OAuth.

## Project structure
- `entrypoints/background/index.ts` — action handler, condense logic, list tab focus/pin.
- `entrypoints/nufftabs/` — list UI (`index.html`, `index.ts`, `style.css`).
- `entrypoints/options/` — settings UI for theme, exclude pinned tabs, restore batch size, duplicate handling, memory-saving restore, and Drive backup actions.
- `entrypoints/drive/` — Drive auth helpers, REST client, and backup orchestration logic.
- `entrypoints/ui/notifications.ts` — shared user-notification adapters used by UI pages (snackbar + inline status text).
- `public/icon/` — PNG icons (16/19/32/38/48/96/128).
- `wxt.config.ts` — manifest config and permissions.

## Permissions
- `tabs`: required to query, create, update, close, and discard tabs/windows.
- `storage`: required to persist `savedTabsIndex`, `savedTabs:<groupKey>`, `savedTabGroupMetadata:<groupKey>`, and settings in `chrome.storage.local`.
- `identity`: required to acquire OAuth tokens for optional Google Drive backup actions.
- `https://www.googleapis.com/` host permission: required to call Google Drive REST APIs for manual backup/restore.

## Troubleshooting
- **List doesn’t update after condense:** reload the list tab or check the service worker console for errors.
- **Condense closes tabs but list is empty:** check `chrome.storage.local` in DevTools and ensure the list tab is open.
- **No action when clicking icon:** open `chrome://extensions`, click “service worker” for nufftabs, and check logs.
- **Google Drive auth says `bad client id`:** ensure `GOOGLE_OAUTH_CLIENT_ID` is for a Chrome Extension OAuth client whose extension ID matches the one generated from `CHROME_EXTENSION_KEY`.

## FAQ

**Why does condense focus a list tab in another window?**  
If any list tab exists, nufftabs reuses the most recently active one instead of creating duplicates.

**Where is data stored?**  
In `chrome.storage.local` under `savedTabsIndex`, `savedTabs:<groupKey>`, `savedTabGroupMetadata:<groupKey>`, and `settings`.

**Why are pinned tabs excluded by default?**  
It’s a safety default so pinned tabs are not closed unless you turn the setting off.

## License
MIT. See `LICENSE`.
