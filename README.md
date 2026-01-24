# nufftabs

nufftabs is a minimal Chrome (MV3) extension to condense all tabs from the current window into a saved list, then restore them later. It uses WXT for build/dev and stores state in `chrome.storage.local`.

## Core features
- Condense tabs from the current window (optionally excluding pinned tabs).
- List UI with restore single, restore all, delete all, export/import JSON.
- Restore rules: single restore uses the current window; restore all opens a new window unless the list tab is the only tab.
- List tab is pinned and reused if it already exists.
- Settings page for “Exclude pinned tabs”.

## How it works

### Condense
- Triggered by clicking the extension action icon.
- Reads settings (`excludePinned`) from `chrome.storage.local`.
- Saves eligible tabs (URL + title + timestamp) to `savedTabs`.
- Closes eligible tabs.
- Focuses an existing nufftabs list tab if one exists anywhere (most recently active), or creates a new one if none exist. The list tab is pinned.

### List page
- Unlisted page at `/nufftabs.html`.
- Renders saved tabs from `chrome.storage.local`.
- Refreshes on storage changes and when the tab becomes visible.

### Restore rules
- **Restore single:** always opens the tab in the current window (the window that contains the list tab) and keeps the list tab open and pinned.
- **Restore all:** opens a new window by default. Exception: if the list tab is the only tab in the current window, all restored tabs open in that same window (list tab remains open and active).

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

## Load unpacked in Chrome
1. Run `pnpm dev` (or `pnpm build`).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the build output directory:
   - Dev: `.output/chrome-mv3/`
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
3. The list item is removed from storage.

### Restore all (new window unless list tab is only tab)
1. Click **Restore all**.
2. If the list tab is not the only tab in the window, a **new window** opens with all saved tabs.
3. If the list tab is the only tab, all restored tabs open **in the same window**, and the list tab stays open.

### Delete all
1. Click **Delete all**.
2. The saved list is cleared.

### Export / Import JSON
1. Click the Export/Import control to open the panel.
2. **Export** populates the JSON textarea and copies to clipboard (if allowed).
3. **Import (replace)** reads the textarea and replaces the saved list if valid.

### Import from OneTab
1. In OneTab, open “Export / Import URLs” and copy the text.
2. Paste it into the nufftabs Import panel textarea.
3. Click **Import OneTab** to append those tabs to the current list.

### Exclude pinned tabs
1. Open the options page (Extension details → “Extension options”).
2. Toggle **Exclude pinned tabs**.
3. When enabled, pinned tabs are not saved or closed during condense.

### Existing list tab reuse
- If a list tab already exists anywhere, condense focuses the most recently active one.
- If none exists, a new list tab is created and pinned.

## Project structure
- `entrypoints/background/index.ts` — action handler, condense logic, list tab focus/pin.
- `entrypoints/nufftabs/` — list UI (`index.html`, `index.ts`, `style.css`).
- `entrypoints/options/` — settings UI for exclude pinned.
- `public/icon/` — PNG icons (16/19/32/38/48/96/128).
- `wxt.config.ts` — manifest config and permissions.

## Permissions
- `tabs`: required to query, create, update, move, and close tabs/windows.
- `storage`: required to persist `savedTabs` and settings in `chrome.storage.local`.

## Troubleshooting
- **List doesn’t update after condense:** reload the list tab or check the service worker console for errors.
- **Condense closes tabs but list is empty:** check `chrome.storage.local` in DevTools and ensure the list tab is open.
- **No action when clicking icon:** open `chrome://extensions`, click “service worker” for nufftabs, and check logs.

## FAQ

**Why does condense focus a list tab in another window?**  
If any list tab exists, nufftabs reuses the most recently active one instead of creating duplicates.

**Where is data stored?**  
In `chrome.storage.local` under `savedTabs` and `settings`.

**Why are pinned tabs excluded by default?**  
It’s a safety default so pinned tabs are not closed unless you turn the setting off.

## License
MIT. See `LICENSE`.
