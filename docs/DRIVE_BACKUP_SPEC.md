# Drive Backup Spec

## Summary
nufftabs supports optional manual backup and restore to Google Drive. This feature is user-initiated from the options page and does not run automatically.

## User-visible behavior
- Users connect/disconnect Google Drive directly from the options-page Drive section.
- Users click **Backup now** to upload a full snapshot.
- Users can configure retention (default: 10 backups).
- Users can restore any listed backup in two ways:
- `Merge` appends backup groups into the current local tab lists without removing existing groups.
- `Restore` keeps the original overwrite behavior for local saved tabs + settings.

## Permissions and OAuth
- `identity` permission is required for `chrome.identity.getAuthToken`.
- Host permission: `https://www.googleapis.com/` for Drive API calls.
- OAuth scope: `https://www.googleapis.com/auth/drive.file`.
- OAuth client ID is configured in `wxt.config.ts`.
- For local/unpacked builds, set a stable manifest key (`CHROME_EXTENSION_KEY` or `EXTENSION_MANIFEST_KEY`) so the extension ID matches the OAuth client's configured Chrome Extension ID.
- `GOOGLE_OAUTH_CLIENT_ID` can override the default client ID in `wxt.config.ts`.

## Data model
Drive folder layout:
- `nufftabs_backups/<install_id>/nufftabs-backup-<timestamp>-g<groupCount>.json`

Local storage keys:
- `driveInstallId`: stable install folder identifier
- `driveBackupIndex`: local metadata cache for backup rows
- `driveRetentionCount`: retention setting

Backup JSON shape:
```json
{
  "version": 1,
  "timestamp": 1700000000000,
  "installId": "...",
  "savedTabs": { "groupKey": [{ "id": "...", "url": "...", "title": "...", "savedAt": 1700000000000 }] },
  "settings": {
    "excludePinned": true,
    "restoreBatchSize": 100,
    "discardRestoredTabs": false,
    "duplicateTabsPolicy": "allow",
    "theme": "os"
  }
}
```

## Implementation boundaries
- Drive logic is isolated under `entrypoints/drive/`.
- Options page owns all user-facing auth, backup, and restore controls.
- Existing storage module is reused for writing restored tabs/settings, and shared merge helpers are reused for non-destructive merge restore.

## Retention
- Retention is enforced immediately after successful upload.
- Backup files are sorted newest-first.
- Files past the retention cutoff are deleted via Drive API.

## Error behavior
- Errors are surfaced as status text in the options page.
- Drive fallback listing failures keep local UI responsive and show an empty list.
- Restore fails fast on malformed payloads.

## Test coverage
- Unit tests cover: Drive API requests, auth wrappers, backup orchestration helpers.
- Integration tests cover: options-page backup and restore interactions with mocked Chrome + fetch.
