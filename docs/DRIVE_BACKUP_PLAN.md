# Google Drive Manual Backup — Implementation Plan

Add manual backup/restore to Google Drive for the NuffTabs Chrome extension. Users click "Backup Now" in Settings to upload a timestamped snapshot of saved tabs + settings. Backups are stored in `nufftabs_backups/<install_id>/` on Drive. Retention (default 30) trims old files. Restore lets users either merge a backup into existing tab lists or replace local data entirely.

## User Review Required

> [!NOTE]
> **OAuth Client ID**: Using `316914322209-3tclnhiqvs72o6807749be29llob6sgo.apps.googleusercontent.com` (provided by user).

> [!WARNING]
> **New permissions**: `identity` is added to `permissions` (for `chrome.identity.getAuthToken`). `https://www.googleapis.com/` is added to `host_permissions` (for Drive REST API calls). Both are required for CWS OAuth.

## Proposed Changes

### Drive Modules (`entrypoints/drive/`)

All Drive-related code lives in its own folder, separate from `entrypoints/shared/`. Pure functions with explicit dependency injection for testability — no DOM code.

#### [NEW] [types.ts](file:///Users/vp-dc/Documents/GitHub/nufftabs/entrypoints/drive/types.ts)

Drive-specific types and constants:
- `DriveBackupEntry` — `{ fileId, timestamp, size, tabGroupCount }`
- `DriveBackupIndex` — `{ installId, backups: DriveBackupEntry[] }`
- `DRIVE_STORAGE_KEYS` — `{ driveBackupIndex, installId }`
- `DRIVE_FOLDER_NAME` = `'nufftabs_backups'`
- `DEFAULT_RETENTION_COUNT` = `30`
- `BACKUP_VERSION` = `1`

#### [NEW] [drive_api.ts](file:///Users/vp-dc/Documents/GitHub/nufftabs/entrypoints/drive/drive_api.ts)

Google Drive REST API client. Functions for:
- `getOrCreateFolder(name, parentId?, token)` — finds or creates a folder by name
- `listFiles(folderId, token)` — lists files in a folder (sorted by name descending)
- `uploadJsonFile(name, content, folderId, token)` — multipart upload of JSON file
- `downloadJsonFile(fileId, token)` — download file content by ID
- `deleteFile(fileId, token)` — delete a file by ID

All functions take an OAuth token parameter (no global state). Uses `fetch()` with Drive REST v3 endpoints. Returns typed results.

#### [NEW] [drive_backup.ts](file:///Users/vp-dc/Documents/GitHub/nufftabs/entrypoints/drive/drive_backup.ts)

Backup orchestration logic. Functions for:
- `getOrCreateInstallId()` — reads/creates `installId` in `chrome.storage.local` using `crypto.randomUUID()`
- `serializeBackup(groups, settings)` — creates the portable backup JSON payload `{ version: 1, timestamp, savedTabs, settings }`
- `performBackup(token, retention?, deps?, preloaded?)` — orchestrates: read data → serialize → upload → update local index → run retention (optionally reuses preloaded groups/settings to avoid duplicate reads)
- `enforceRetention(installFolderId, retentionCount, token)` — lists backups, deletes oldest beyond N
- `updateLocalIndex(installId, backups)` — writes local backup index to `chrome.storage.local`
- `readLocalIndex()` → reads and normalizes the local backup index
- `restoreFromBackup(fileId, token)` — downloads backup → validates → writes to storage using existing `writeSavedGroups()`
- `listDriveBackups(token)` — fallback: list backups from Drive when local index is missing/corrupt

### Settings UI Updates

Extend the existing options page with a "Google Drive Backup" section.

#### [MODIFY] [index.html](file:///Users/vp-dc/Documents/GitHub/nufftabs/entrypoints/options/index.html)

Add a new `<section>` after the settings section:
- "Google Drive Backup" heading
- "Connect to Google Drive" link/button → opens auth tab
- "Backup Now" button (disabled until connected)
- Retention count number input (default 30)
- Backup list (table of timestamps from local index)
- "Restore" button per backup row
- Status/feedback area

#### [MODIFY] [settings_page.ts](file:///Users/vp-dc/Documents/GitHub/nufftabs/entrypoints/options/settings_page.ts)

Add backup UI initialization:
- Check auth status on page load (non-interactive `getAuthToken`)
- Wire "Backup Now" button to `performBackup()`
- Wire retention count input to settings
- Render backup list from local index
- Wire restore buttons

#### [MODIFY] [style.css](file:///Users/vp-dc/Documents/GitHub/nufftabs/entrypoints/options/style.css)

Add styles for the backup section: backup list table, restore buttons, disabled states.

---

### Storage & Config Updates

No changes to `storage.ts` — all Drive types/constants live in `entrypoints/drive/types.ts`.

#### [MODIFY] [wxt.config.ts](file:///Users/vp-dc/Documents/GitHub/nufftabs/wxt.config.ts)

- Add `'identity'` to `permissions`
- Add `host_permissions: ['https://www.googleapis.com/']`
- Add `oauth2: { client_id: '316914322209-3tclnhiqvs72o6807749be29llob6sgo.apps.googleusercontent.com', scopes: ['https://www.googleapis.com/auth/drive.file'] }`

---

### Privacy & Documentation

#### [MODIFY] [PRIVACY_POLICY.md](file:///Users/vp-dc/Documents/GitHub/nufftabs/PRIVACY_POLICY.md)

Add section about optional Google Drive backup:
- Data stored in user's own Drive account
- User-initiated only
- No automatic upload
- OAuth scope limited to `drive.file` (only files the extension creates)
- User can disconnect at any time

#### [NEW] [DRIVE_BACKUP_SPEC.md](file:///Users/vp-dc/Documents/GitHub/nufftabs/docs/DRIVE_BACKUP_SPEC.md)

Complete feature spec covering data model, permissions, privacy impact, CWS disclosure text.

---

## Verification Plan

### Automated Tests

All tests use the existing vitest setup with `mock_chrome.ts`. Run via:

```bash
pnpm test
```

This runs `vitest run --coverage` which enforces 90% thresholds on statements, branches, functions, and lines.

#### [NEW] Unit tests: `tests/unit/drive_backup_utils.test.ts`
- `getOrCreateInstallId()`: returns stored ID, generates new if missing
- `serializeBackup()`: correct portable shape, timestamp, version field
- `enforceRetention()`: keeps N newest, deletes oldest in order
- `updateLocalIndex()`: writes correct structure
- `readLocalIndex()`: normalizes corrupt/missing data
- `restoreFromBackup()`: validates payload, calls `writeSavedGroups()`

#### [NEW] Unit tests: `tests/unit/drive_api.test.ts`
- `getOrCreateFolder()`: creates folder when missing, returns existing
- `uploadJsonFile()`: correct multipart body
- `deleteFile()`: correct DELETE request
- Mock `fetch()` for all Drive REST API calls

#### [NEW] Integration tests: `tests/integration/drive_backup.test.ts`
- Connect → backup → verify local index updated
- Backup → retention trimming verification
- Restore from backup
- Auth failure handling
- Upload failure handling
- Missing local index → fallback to Drive listing

#### Coverage exclusion
- No extra coverage exclusion needed beyond DOM-heavy entrypoint glue already covered by integration/E2E tests

#### Existing tests (must still pass):
- `tests/unit/storage_utils.test.ts`
- `tests/integration/storage.test.ts`
- `tests/integration/options_page.test.ts`
- All other existing test files

### CI-Equivalent Local Steps

```bash
# 1. TypeScript compilation check
pnpm compile

# 2. Lint
pnpm lint

# 3. Tests with coverage (must pass 90% thresholds)
pnpm test

# 4. Build (production, no sourcemaps)
pnpm build
```

### Manual Verification
- Verify `manifest.json` in build output has correct permissions
- Verify no sourcemaps in build output
- Verify placeholder OAuth client ID is clearly documented
