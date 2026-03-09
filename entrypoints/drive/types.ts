/**
 * Shared Drive-backup types and constants used by backup orchestration,
 * Drive API adapters, and options/auth UI code.
 */
import type { SavedTabGroups, Settings } from "../shared/storage";
import {
	createNufftabsBackupFileName,
	extractTabGroupCountFromBackupFileName,
} from "../shared/backup_filename";

/** The top-level folder name used in the user's Google Drive. */
export const DRIVE_FOLDER_NAME = "nufftabs_backups";

/** Current schema version for serialized backup payloads. */
export const BACKUP_VERSION = 1;

/** Default max number of remote backup files kept per install ID folder. */
export const DEFAULT_RETENTION_COUNT = 10;

/** Lowest retention value accepted from user input/storage. */
const MIN_RETENTION_COUNT = 1;

/** Highest retention value accepted from user input/storage. */
const MAX_RETENTION_COUNT = 500;

/** Storage keys used only by the Drive backup feature. */
export const DRIVE_STORAGE_KEYS = {
	driveBackupIndex: "driveBackupIndex",
	installId: "driveInstallId",
	retentionCount: "driveRetentionCount",
} as const;

/** One backup file entry shown in the options-page backup list. */
export type DriveBackupEntry = {
	fileId: string;
	fileName: string;
	timestamp: number;
	size: number;
	tabGroupCount: number;
};

/** Local cache of the user's Drive backup metadata for fast options-page rendering. */
export type DriveBackupIndex = {
	installId: string;
	backups: DriveBackupEntry[];
};

/** JSON payload persisted inside each backup file uploaded to Drive. */
export type SerializedBackupPayload = {
	version: number;
	timestamp: number;
	/**
	 * Saved groups and settings are intentionally the only portable backup data.
	 * The Drive install ID still exists locally for folder organization, but it
	 * must never leak into exported backup files or restores become machine-bound.
	 */
	savedTabs: SavedTabGroups;
	settings: Settings;
};

/** Minimal Drive file fields we need for listing backup files. */
export type DriveFileRecord = {
	id: string;
	name: string;
	createdTime?: string;
	modifiedTime?: string;
	size?: string;
};

/**
 * Normalizes unknown retention input into a bounded positive integer.
 * Falls back to the provided default (10 by default) on invalid input.
 */
export function normalizeRetentionCount(
	value: unknown,
	fallback = DEFAULT_RETENTION_COUNT,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const floored = Math.floor(value);
	if (floored < MIN_RETENTION_COUNT) return MIN_RETENTION_COUNT;
	if (floored > MAX_RETENTION_COUNT) return MAX_RETENTION_COUNT;
	return floored;
}

/**
 * Generates a lexicographically sortable backup file name that also embeds
 * a rough tab-group count for listing without downloading each file.
 */
export function createBackupFileName(
	timestamp: number,
	tabGroupCount: number,
): string {
	return createNufftabsBackupFileName(timestamp, tabGroupCount);
}

/**
 * Extracts an embedded tab-group count from backup file names produced by
 * `createBackupFileName`. Returns 0 if the file name does not match.
 */
export function extractTabGroupCountFromFileName(fileName: string): number {
	return extractTabGroupCountFromBackupFileName(fileName);
}

/**
 * Converts a Drive metadata timestamp string to epoch-ms, returning 0 when
 * the input is absent or unparseable.
 */
export function parseDriveTimestamp(value: string | undefined): number {
	if (typeof value !== "string" || value.length === 0) return 0;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : 0;
}
