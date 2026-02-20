# Drive Backup Spec

## Summary
nufftabs supports optional manual backup and restore to Google Drive. This feature is user-initiated from the options page and does not run automatically.

## User-visible behavior
- Users connect Google Drive from a dedicated auth page.
- Users click **Backup now** to upload a full snapshot.
- Users can configure retention (default: 30 backups).
- Users can restore any listed backup, which overwrites local saved tabs + settings.

## Permissions and OAuth
- `identity` permission is required for `chrome.identity.getAuthToken`.
- Host permission: `https://www.googleapis.com/` for Drive API calls.
- OAuth scope: `https://www.googleapis.com/auth/drive.file`.
- OAuth client ID is configured in `wxt.config.ts`.
- For local/unpacked builds, set a stable manifest key (`CHROME_EXTENSION_KEY` or `EXTENSION_MANIFEST_KEY`) so the extension ID matches the OAuth client's configured Chrome Extension ID.
- `GOOGLE_OAUTH_CLIENT_ID` can override the default client ID in `wxt.config.ts`.

## Data model
Drive folder layout:
- `nufftabs_backups/<install_id>/backup-<timestamp>-g<groupCount>.json`

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
    "theme": "os"
  }
}
```

## Implementation boundaries
- Drive logic is isolated under `entrypoints/drive/`.
- Auth page logic is isolated under `entrypoints/drive-auth/`.
- Options page owns all user-facing backup controls.
- Existing storage module is reused for writing restored tabs/settings.

## Retention
- Retention is enforced immediately after successful upload.
- Backup files are sorted newest-first.
- Files past the retention cutoff are deleted via Drive API.

## Error behavior
- Errors are surfaced as status text in options/auth pages.
- Drive fallback listing failures keep local UI responsive and show an empty list.
- Restore fails fast on malformed payloads.

## Test coverage
- Unit tests cover: Drive API requests, auth wrappers, backup orchestration helpers.
- Integration tests cover: options-page backup and restore interactions with mocked Chrome + fetch.
