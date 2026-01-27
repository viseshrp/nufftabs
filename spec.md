# spec.md — nufftabs (WXT)

Enough tabs. Condense tabs into a list, then restore them later.

This spec is written to support an agentic implementation loop (Codex/Copilot/Gemini CLI) similar to Simon Willison’s “porting justhtml” workflow: define milestones, wire a tight acceptance gate early, commit often, and iterate until the checklist passes.

---

## 0) One sentence product definition

**nufftabs** is a minimal MV3 Chrome extension that saves all tabs from the current window into a list and closes them, then lets you restore one tab in the current window or restore all into new windows while removing restored tabs from the list.

---

## 1) Constraints

### 1.1 Tooling
- Project is bootstrapped using **WXT** (Web Extension Toolkit).
- Do not create/maintain a source `manifest.json`; configure manifest via `wxt.config.ts`.
- Use WXT entrypoints for background and options UI.

### 1.2 Supported browsers
- Chrome (MV3) only.
- No explicit support requirements for Firefox/Safari etc.

### 1.3 Storage and permissions
- Persist saved tabs and settings via `chrome.storage.local`.
- Only required permissions:
  - `tabs`
  - `storage`

### 1.4 UI and UX goals
- Functional > pretty.
- No OneTab-like styling or features.
- A single options UI page is enough for the entire app.

---

## 2) Functional requirements

### 2.1 “Condense” (primary action)
Triggered by clicking the extension action icon.

**Behavior**
1. Query all tabs in the current window.
2. Apply settings:
   - If Exclude pinned tabs is ON: do not save pinned tabs; do not close pinned tabs.
   - If OFF: pinned tabs are treated like normal tabs (saved and closed).
3. Save eligible tabs into the nufftabs list.
4. Close eligible tabs.
5. Open the nufftabs UI page (Options page) to show the saved list.

**Eligible tab definition**
- Must have a `url` that can be saved (string).
- No special-case logic required; if it has a URL string, save it.

**Data captured per saved tab**
- `id`: string UUID
- `url`: string
- `title`: string (fallback: url)
- `savedAt`: number (epoch ms)

### 2.2 Saved list UI
A 'lists' page renders:
- List of saved tabs (most recent first is fine).
- Each item shows at least: Title + URL.
- Per-item action: Restore (current window).
- Top-level actions:
  - Restore all (new windows unless list tab is only tab)
  - Delete all
  - Export JSON
  - Import JSON (replace)

### 2.3 Restore single (current window + remove from list)
When user clicks Restore on an item:
1. Open the tab in the current window (the one containing the list UI).
2. If the current window is unavailable, fall back to a new window.
3. If ?Save memory when restoring tabs? is enabled, discard the restored tab (best-effort).
4. Remove that item from stored list immediately.
5. Re-render UI reflecting removal.

### 2.4 Restore all (chunked windows + clear list)
When user clicks Restore all:
1. If list is empty: do nothing (optional status message).
2. Split tabs into chunks using `restoreBatchSize`.
3. If the list tab is the only tab in its window, use that window for the first chunk.
4. Otherwise, create a new window for each chunk.
5. Create remaining tabs in each window.
6. If ?Save memory when restoring tabs? is enabled, discard restored tabs (best-effort).
7. Clear stored list.
8. Re-render UI showing empty state.

### 2.5 Delete all
When user clicks Delete all:
- Clear stored list.
- Re-render empty state.

### 2.6 Export / Import JSON
**Export JSON**
- Produces JSON representing the saved list into a textarea.
- Recommended format: `{ "savedTabs": [ ... ] }`
- Pretty-print (2 spaces) is preferred.

**Import JSON (replace)**
- Reads JSON from textarea.
- If valid:
  - Replace the current saved list with imported data.
- Minimal validation:
  - must be array OR object containing `savedTabs` array
  - each entry must contain a string `url`
  - if missing `id`, generate UUID
  - if missing `title`, set to url
  - if missing `savedAt`, set to now
- On invalid JSON, show a clear error message (status area).

---

## 3) Non-goals (explicitly excluded)
- No “save without closing” mode.
- No deduplication.
- No grouping, naming groups, or drag ordering.
- No search/filter.
- No keyboard shortcut.
- No context menu.
- No special casing for `chrome://` or internal tabs beyond basic validation.
- Settings are stored locally (no sync); saved tabs remain local-only.
- No attempt to match OneTab UX.

---

## 4) Settings

### 4.1 Exclude pinned tabs
- Name: `excludePinned`
- Type: boolean
- Default: `true`
- UI: checkbox in the Options page
- Storage: `chrome.storage.local` under a `settings` object

### 4.2 Tabs per restore window
- Name: `restoreBatchSize`
- Type: number
- Default: `100`
- UI: number input in the Options page
- Behavior: controls how many tabs open per window during Restore all
- Storage: `chrome.storage.local` under a `settings` object

### 4.3 Save memory when restoring tabs
- Name: `discardRestoredTabs`
- Type: boolean
- Default: `false`
- UI: radio group in the Options page (Disabled/Enabled)
- Behavior: if enabled, restored tabs are discarded immediately (best-effort) and load on click
- Storage: `chrome.storage.local` under a `settings` object

---

## 5) Data model and storage keys

### 5.1 Storage keys
- `savedTabs`: `SavedTab[]`
- `settings`: `{ excludePinned: boolean, restoreBatchSize: number, discardRestoredTabs: boolean }`

### 5.2 Types
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

---

## 6) WXT structure (expected files)

Exact filenames may vary slightly by WXT template; follow WXT entrypoints conventions and wire manifest via `wxt.config.ts`.

### 6.1 Background service worker
- `entrypoints/background/index.ts`
  - listens to `chrome.action.onClicked`
  - implements “Condense”
  - saves list + closes tabs
  - opens the options UI page

### 6.2 Options UI
- `entrypoints/options/index.html`
- `entrypoints/options/index.ts` (or similar) for UI logic
- `entrypoints/options/style.css` (optional)

### 6.3 WXT config
- `wxt.config.ts`
  - `manifest.permissions = ["tabs", "storage"]`
  - `manifest.action.default_title = "Condense tabs"`
  - ensure options entrypoint is registered by convention

---

## 7) Milestones (agentic execution plan)

### Milestone 0 — Repo sanity and guardrails
Goal: ensure WXT build/dev works and basic entrypoints are recognized.

- Confirm `wxt dev` runs without errors in the bootstrapped repo.
- Confirm background entrypoint is loaded (service worker present).
- Confirm options entrypoint opens (even static HTML).

Acceptance:
- No errors in `chrome://extensions` after loading dev build.

### Milestone 0.5 — Smoke test (tiny end-to-end)
Goal: prove the core loop works with a minimal implementation.

Requirements:
- Clicking action icon:
  - saves all tabs from current window (ignore pinned for now)
  - closes those tabs
  - opens options page showing the list
- Restore single:
  - opens the tab in the current window
  - removes item from list

Acceptance checklist:
1. Open 3 normal tabs.
2. Click action icon.
3. Tabs close; options page shows 3 items.
4. Click Restore on one item.
5. The tab opens in the current window; list now shows 2 items.

### Milestone 1 — Settings: Exclude pinned tabs
Goal: pinned toggle fully implemented and default ON.

Acceptance checklist:
1. Open 4 tabs; pin 2.
2. Ensure Exclude pinned = ON.
3. Click action icon.
4. Only 2 non-pinned tabs are saved and closed; pinned remain open.
5. Turn Exclude pinned = OFF.
6. Open 2 more tabs; pin 1 of them.
7. Click action icon.
8. All eligible tabs including pinned are saved and closed.

### Milestone 2 — Restore all and delete all
Goal: required bulk operations.

Acceptance checklist:
1. With at least 5 saved tabs:
2. Click Restore all.
3. One or more windows open containing all saved tabs (based on restore batch size).
4. Saved list is empty.
5. Condense again; then click Delete all.
6. Saved list becomes empty; no windows open.

### Milestone 3 — Export/Import JSON
Goal: JSON portability.

Acceptance checklist:
1. Condense 3 tabs.
2. Export JSON and confirm textarea contains JSON.
3. Delete all; list empty.
4. Paste previously exported JSON and Import (replace).
5. List repopulates with same 3 URLs.
6. Import invalid JSON → status shows error and list unchanged.

### Milestone 4 — Polish and reliability pass
Goal: stable behavior and clear UX.

Requirements:
- Defensive handling:
  - No eligible tabs → do nothing, optionally open options page with empty state.
  - Empty list restore/delete operations should not throw.
- Minimal status area:
  - show short messages for restore/delete/import errors.
- Remove unused code; keep it readable.
- Ensure no extra permissions are added.

Acceptance:
- All prior milestone checklists pass.
- No console errors during normal operations.

---

## 8) Manual test script (final acceptance)

### A. Load / dev
1. Run `wxt dev` (or your WXT Chrome dev workflow).
2. Load the extension into Chrome (unpacked / WXT dev output).
3. Confirm no extension errors.

### B. Condense basic
1. Open 5 tabs.
2. Click action icon.
3. Options page opens with 5 items.
4. Original window now has tabs closed (except any excluded pinned).

### C. Exclude pinned
1. Open 4 tabs; pin 2.
2. Exclude pinned ON.
3. Condense.
4. Pinned remain, 2 saved.
5. Turn OFF; open 2 tabs and pin 1; condense.
6. Confirm pinned got saved and closed.

### D. Restore single removes it
1. Click Restore on one item.
2. The tab opens in the current window (list tab window).
3. Item disappears from list.

### E. Restore all clears list and opens new windows
1. Click Restore all.
2. New window(s) open for the restored tabs (based on restore batch size).
3. List empty.

### F. Delete all
1. Condense again.
2. Delete all.
3. List empty.

### G. Export/Import
1. Condense 3.
2. Export JSON.
3. Delete all.
4. Import JSON.
5. List restored.
6. Try invalid JSON: must show error.

### H. Save memory on restore
1. Enable ?Save memory when restoring tabs?.
2. Restore all and confirm tabs appear but load on click.
3. Restore single and confirm it is discarded until clicked.

---

## 9) Implementation notes (agent guidance)

### 9.1 Keep action logic in background
- Background queries/closes tabs and writes storage.
- Options UI reads storage and triggers restore operations.

### 9.2 Restore operations from Options page
- Options page can call `chrome.windows.create()` and `chrome.tabs.create()` directly with permissions.
- After opening, it must update storage to remove items.

### 9.3 Ordering
- Store new saves at the front (most recent first) or back; pick one and keep consistent.

### 9.4 UUID generation
- Use `crypto.randomUUID()` where available.

---

## 10) Agent execution instructions

### 10.1 Agent prompt (drop-in)
Use this as the single prompt to your agent:

Read `spec.md` and implement nufftabs in this WXT repo.
- Do not add features outside spec.
- Use WXT entrypoints and configure manifest via `wxt.config.ts`.
- Implement milestones in order. After each milestone, keep commits small and frequent.
- Provide final manual test steps and how to run dev/build with WXT.

### 10.2 Commit discipline (recommended)
Commit after each milestone (or sub-step). Suggested messages:
- `milestone 0.5: condense + restore single smoke test`
- `milestone 1: exclude pinned setting`
- `milestone 2: restore all + delete all`
- `milestone 3: export/import JSON`
- `milestone 4: polish + reliability`

### 10.3 Feedback loop format
When you find a bug, report back to the agent like this:

- Steps:
- Observed:
- Expected:
- Console error (if any):

Example:
- Steps: Condense 5 tabs → Restore all
- Observed: 5 new windows opened
- Expected: restored tabs open in the list window if it is the only tab, otherwise new window(s) based on restore batch size
- Console: (paste)

---

## 11) Done definition
Project is done when:
- All milestone acceptance checklists pass
- No extra features exist beyond spec
- No extension errors in Chrome Extensions page
- Code is small, readable, and uses only `tabs` + `storage` permissions
