/**
 * Shared backup filename helpers used by:
 * - the list-page "Export" download (local JSON backup), and
 * - the Google Drive manual backup upload.
 *
 * Why this exists:
 * - Users should see one consistent naming convention everywhere.
 * - The timestamp should be readable and lexicographically sortable.
 * - The `-g<groupCount>` suffix helps identify the approximate backup size without opening it.
 *
 * Canonical format:
 * `nufftabs-backup-<timestamp>-g<groupCount>.json`
 *
 * Example:
 * `nufftabs-backup-2026-02-23T02-20-49-747Z-g22.json`
 */

/** File prefix used for all NuffTabs backup downloads/uploads. */
export const NUFFTABS_BACKUP_FILE_PREFIX = 'nufftabs-backup';

/**
 * Converts an epoch-ms timestamp into the filename-friendly ISO segment used by backup files.
 *
 * Notes:
 * - Uses UTC via `toISOString()` so backups are comparable across machines/timezones.
 * - Replaces `:` and `.` with `-` so the filename is Windows-friendly and matches prior behavior.
 */
export function formatBackupTimestampSegment(timestampMs: number): string {
  const safeTimestamp = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  return new Date(safeTimestamp).toISOString().replace(/[:.]/g, '-');
}

/**
 * Creates a standardized backup filename embedding the timestamp and tab-group count.
 * The returned string is safe to use as a download name and as a Drive file name.
 */
export function createNufftabsBackupFileName(timestampMs: number, tabGroupCount: number): string {
  const timestampSegment = formatBackupTimestampSegment(timestampMs);
  const normalizedGroupCount = Math.max(0, Math.floor(tabGroupCount));
  return `${NUFFTABS_BACKUP_FILE_PREFIX}-${timestampSegment}-g${normalizedGroupCount}.json`;
}

/**
 * Extracts the `-g<groupCount>` suffix from a backup filename.
 *
 * This intentionally does not require the canonical prefix so older/foreign names
 * can still be surfaced in the UI with a best-effort group count.
 */
export function extractTabGroupCountFromBackupFileName(fileName: string): number {
  const match = /-g(\d+)\.json$/i.exec(fileName);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

