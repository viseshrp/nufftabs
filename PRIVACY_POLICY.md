# Privacy Policy for nufftabs

Effective date: 2026-02-12

## Summary
nufftabs stores and restores your tabs locally by default. It also includes an optional, user-initiated Google Drive backup feature.

## Data the extension processes
- Tab URLs
- Tab titles
- Saved timestamps
- A grouping key derived from the current window id (stored as a string)
- Settings values: `theme`, `excludePinned`, `restoreBatchSize`, `discardRestoredTabs`
- Any JSON you paste or import for restore (user-initiated), including OneTab export text
- Optional Google Drive backup metadata:
  - Drive install ID
  - Backup index metadata (Drive file ID, timestamp, file size, group count)
  - Backup retention setting

## How data is used
- To save tabs into a local list and restore them on request.
- To display saved tabs in the extension UI.
- To import or export saved tabs when you choose to do so.
- To upload/download backups to your own Google Drive account when you explicitly use Drive backup actions.

## Storage and retention
- Saved tabs are stored locally in chrome.storage.local on your device.
- Settings are stored locally in chrome.storage.local.
- Data remains until you delete it or restore tabs, or until you clear extension storage.
- If you export data, the file/clipboard contents are under your control and remain wherever you save them.
- If you use Google Drive backup, backup files are stored in your Drive under `nufftabs_backups/<install_id>/`.
- Drive backups are retained according to your configured retention count (default 30).

## Sharing and selling
- No data is sold or shared with third parties.
- No analytics, trackers, or advertising services are used.

## Network access
- Local tab management does not require network access.
- Optional Drive backup/restore makes requests to:
  - `https://www.googleapis.com/` (Google Drive REST API)
  - `https://accounts.google.com/o/oauth2/revoke` (token revocation on disconnect)
- OAuth scope used: `https://www.googleapis.com/auth/drive.file` (limited to files the extension creates/opens with this scope).
- Drive uploads/downloads only occur after explicit user actions (for example Backup now, Restore, Connect, Disconnect).
