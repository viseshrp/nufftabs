/**
 * Drive backup orchestration: serialization, upload/list/retention workflows,
 * local backup-index caching, and restore flows.
 */
import {
	normalizeSavedGroups,
	normalizeSavedGroupMetadata,
	readSavedGroupMetadata,
	readSavedGroups,
	readSettings,
	writeSavedGroups,
	filterSavedGroupMetadataForKeys,
	type SavedTabGroupMetadata,
	type SavedTabGroups,
} from "../shared/storage";
import { mergeGroupMetadata, mergeGroups } from "../shared/group_merge";
import { logExtensionError, runWithConcurrency } from "../shared/utils";
import {
	deleteFile,
	downloadJsonFile,
	getOrCreateFolder,
	listFiles,
	listFilesPage,
	uploadJsonFile,
	type DriveListFilesPage,
} from "./drive_api";
import {
	BACKUP_VERSION,
	createBackupFileName,
	DEFAULT_RETENTION_COUNT,
	DRIVE_FOLDER_NAME,
	DRIVE_STORAGE_KEYS,
	extractTabGroupCountFromFileName,
	normalizeRetentionCount,
	parseDriveTimestamp,
	type DriveBackupEntry,
	type DriveBackupIndex,
	type DriveFileRecord,
	type SerializedBackupPayload,
} from "./types";

/** Dependency bag used by pure/testable backup orchestration helpers. */
type DriveApiDeps = {
	getOrCreateFolder: typeof getOrCreateFolder;
	listFiles: typeof listFiles;
	listFilesPage?: typeof listFilesPage;
	uploadJsonFile: typeof uploadJsonFile;
	downloadJsonFile: typeof downloadJsonFile;
	deleteFile: typeof deleteFile;
};

/** Default production dependencies that hit the real Drive REST API. */
const defaultDeps: DriveApiDeps = {
	getOrCreateFolder,
	listFiles,
	listFilesPage,
	uploadJsonFile,
	downloadJsonFile,
	deleteFile,
};

/** Max number of concurrent Drive delete calls when enforcing retention. */
const RETENTION_DELETE_CONCURRENCY = 4;

/**
 * Converts Drive file metadata into normalized local backup entries used by
 * options-page rendering and local-index caching.
 */
function toBackupEntries(files: DriveFileRecord[]): DriveBackupEntry[] {
	const entries = files
		.filter((file) => typeof file.id === "string" && file.id.length > 0)
		.map((file) => {
			const timestamp =
				parseDriveTimestamp(file.createdTime) ||
				parseDriveTimestamp(file.modifiedTime) ||
				Date.now();
			const parsedSize = Number(file.size);
			return {
				fileId: file.id,
				fileName: typeof file.name === "string" ? file.name : "backup.json",
				timestamp,
				size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 0,
				tabGroupCount: extractTabGroupCountFromFileName(
					typeof file.name === "string" ? file.name : "",
				),
			};
		});

	entries.sort((a, b) => {
		if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
		return a.fileName.localeCompare(b.fileName);
	});
	return entries;
}

/**
 * Reads or generates a stable install ID used to isolate each user's backups
 * into a dedicated Drive subfolder.
 */
export async function getOrCreateInstallId(): Promise<string> {
	const raw = await chrome.storage.local.get([DRIVE_STORAGE_KEYS.installId]);
	const existing = raw[DRIVE_STORAGE_KEYS.installId];
	if (typeof existing === "string" && existing.length > 0) return existing;

	const created = crypto.randomUUID();
	await chrome.storage.local.set({ [DRIVE_STORAGE_KEYS.installId]: created });
	return created;
}

/** Creates a serializable backup payload from saved groups and their portable metadata. */
export function serializeBackup(
	groups: SavedTabGroups,
	timestamp = Date.now(),
	groupMetadata: SavedTabGroupMetadata = {},
): SerializedBackupPayload {
	const filteredMetadata = filterSavedGroupMetadataForKeys(
		groupMetadata,
		Object.keys(groups),
	);
	return {
		version: BACKUP_VERSION,
		timestamp,
		// Keep Drive backups portable and scoped to tab data only. Settings stay
		// in extension storage so restores never overwrite install-specific prefs.
		savedTabs: groups,
		groupMetadata: filteredMetadata,
	};
}

/** Reads and normalizes retention count setting for Drive backups. */
export async function readRetentionCount(): Promise<number> {
	const raw = await chrome.storage.local.get([
		DRIVE_STORAGE_KEYS.retentionCount,
	]);
	return normalizeRetentionCount(
		raw[DRIVE_STORAGE_KEYS.retentionCount],
		DEFAULT_RETENTION_COUNT,
	);
}

/** Writes normalized retention count to storage. */
export async function writeRetentionCount(
	retentionCount: number,
): Promise<number> {
	const normalized = normalizeRetentionCount(
		retentionCount,
		DEFAULT_RETENTION_COUNT,
	);
	await chrome.storage.local.set({
		[DRIVE_STORAGE_KEYS.retentionCount]: normalized,
	});
	return normalized;
}

/**
 * Reads the locally cached backup index. Returns an empty normalized index when
 * missing or malformed so UI code always receives a stable shape.
 */
export async function readLocalIndex(): Promise<DriveBackupIndex> {
	const raw = await chrome.storage.local.get([
		DRIVE_STORAGE_KEYS.driveBackupIndex,
		DRIVE_STORAGE_KEYS.installId,
	]);
	const rawInstallId = raw[DRIVE_STORAGE_KEYS.installId];
	const installId =
		typeof rawInstallId === "string" && rawInstallId.length > 0
			? rawInstallId
			: "";

	const fallback: DriveBackupIndex = { installId, backups: [] };
	const index = raw[DRIVE_STORAGE_KEYS.driveBackupIndex];
	if (!index || typeof index !== "object") return fallback;

	const maybeInstallId = (index as { installId?: unknown }).installId;
	const maybeBackups = (index as { backups?: unknown }).backups;
	if (typeof maybeInstallId !== "string" || !Array.isArray(maybeBackups))
		return fallback;

	const normalizedBackups = maybeBackups
		.filter((entry): entry is DriveBackupEntry =>
			Boolean(entry && typeof entry === "object"),
		)
		.map((entry) => {
			const fileId = typeof entry.fileId === "string" ? entry.fileId : "";
			const fileName =
				typeof entry.fileName === "string" ? entry.fileName : "backup.json";
			const timestamp =
				typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp)
					? Math.floor(entry.timestamp)
					: Date.now();
			const size =
				typeof entry.size === "number" && Number.isFinite(entry.size)
					? Math.max(0, Math.floor(entry.size))
					: 0;
			const tabGroupCount =
				typeof entry.tabGroupCount === "number" &&
				Number.isFinite(entry.tabGroupCount)
					? Math.max(0, Math.floor(entry.tabGroupCount))
					: extractTabGroupCountFromFileName(fileName);

			return { fileId, fileName, timestamp, size, tabGroupCount };
		})
		.filter((entry) => entry.fileId.length > 0)
		.sort((a, b) => b.timestamp - a.timestamp);

	return {
		installId: maybeInstallId,
		backups: normalizedBackups,
	};
}

/** Writes a normalized local backup index cache to storage. */
export async function updateLocalIndex(
	installId: string,
	backups: DriveBackupEntry[],
): Promise<void> {
	const next: DriveBackupIndex = {
		installId,
		backups: backups
			.filter((entry) => entry.fileId.length > 0)
			.map((entry) => ({
				fileId: entry.fileId,
				fileName: entry.fileName,
				timestamp: Math.floor(entry.timestamp),
				size: Math.max(0, Math.floor(entry.size)),
				tabGroupCount: Math.max(0, Math.floor(entry.tabGroupCount)),
			}))
			.sort((a, b) => b.timestamp - a.timestamp),
	};

	await chrome.storage.local.set({
		[DRIVE_STORAGE_KEYS.driveBackupIndex]: next,
	});
}

/** Resolves the Drive folder path `nufftabs_backups/<installId>` and returns the install folder ID. */
async function getInstallFolderId(
	installId: string,
	token: string,
	deps: Pick<DriveApiDeps, "getOrCreateFolder">,
): Promise<string> {
	const rootFolderId = await deps.getOrCreateFolder(DRIVE_FOLDER_NAME, token);
	return deps.getOrCreateFolder(installId, token, rootFolderId);
}

/**
 * Enforces retention by deleting the oldest files after sorting newest-first.
 * Returns the final kept entries after deletions complete.
 */
export async function enforceRetention(
	installFolderId: string,
	retentionCount: number,
	token: string,
	deps: Pick<DriveApiDeps, "listFiles" | "deleteFile"> = defaultDeps,
): Promise<DriveBackupEntry[]> {
	const normalizedRetention = normalizeRetentionCount(
		retentionCount,
		DEFAULT_RETENTION_COUNT,
	);
	const files = await deps.listFiles(installFolderId, token);
	const entries = toBackupEntries(files);
	if (entries.length <= normalizedRetention) return entries;

	const stale = entries.slice(normalizedRetention);
	await runWithConcurrency(
		stale,
		RETENTION_DELETE_CONCURRENCY,
		async (entry) => {
			await deps.deleteFile(entry.fileId, token);
		},
	);

	return entries.slice(0, normalizedRetention);
}

/**
 * Lists Drive backups for the current install ID and refreshes local cache.
 * This provides recovery when local index cache is missing/corrupt.
 */
export async function listDriveBackups(
	token: string,
	deps: DriveApiDeps = defaultDeps,
): Promise<DriveBackupEntry[]> {
	const installId = await getOrCreateInstallId();
	const installFolderId = await getInstallFolderId(installId, token, deps);
	const files = await deps.listFiles(installFolderId, token);
	const backups = toBackupEntries(files);
	await updateLocalIndex(installId, backups);
	return backups;
}

/** One paginated options-restore listing response. */
type DriveBackupListPage = {
	backups: DriveBackupEntry[];
	nextPageToken: string | null;
};

/**
 * Lists one page of backup metadata for on-demand restore dialogs.
 * This returns only Drive file metadata-derived entries, not backup payload content.
 */
export async function listDriveBackupsPage(
	token: string,
	pageToken?: string,
	pageSize = 25,
	deps: Pick<
		DriveApiDeps,
		"getOrCreateFolder" | "listFilesPage" | "listFiles"
	> = defaultDeps,
): Promise<DriveBackupListPage> {
	const installId = await getOrCreateInstallId();
	const installFolderId = await getInstallFolderId(installId, token, deps);
	const page: DriveListFilesPage =
		typeof deps.listFilesPage === "function"
			? await deps.listFilesPage(installFolderId, token, pageToken, pageSize)
			: pageToken
				? { files: [], nextPageToken: null }
				: {
						files: await deps.listFiles(installFolderId, token),
						nextPageToken: null,
					};
	return {
		backups: toBackupEntries(page.files),
		nextPageToken: page.nextPageToken,
	};
}

/**
 * Performs a full manual backup: read local data, upload to Drive,
 * enforce retention, and refresh local backup-index cache.
 */
export async function performBackup(
	token: string,
	requestedRetentionCount?: number,
	deps: DriveApiDeps = defaultDeps,
	preloaded?: {
		groups?: SavedTabGroups;
		groupMetadata?: SavedTabGroupMetadata;
	},
): Promise<DriveBackupEntry[]> {
	const installId = await getOrCreateInstallId();
	const [groups, groupMetadata] = preloaded?.groups
		? [
				preloaded.groups,
				preloaded.groupMetadata ?? (await readSavedGroupMetadata()),
			]
		: await Promise.all([readSavedGroups(), readSavedGroupMetadata()]);

	const timestamp = Date.now();
	const payload = serializeBackup(groups, timestamp, groupMetadata);
	const content = JSON.stringify(payload, null, 2);

	const installFolderId = await getInstallFolderId(installId, token, deps);
	const groupCount = Object.keys(groups).length;
	const fileName = createBackupFileName(timestamp, groupCount);
	await deps.uploadJsonFile(fileName, content, installFolderId, token);

	const retention =
		typeof requestedRetentionCount === "number"
			? normalizeRetentionCount(
					requestedRetentionCount,
					DEFAULT_RETENTION_COUNT,
				)
			: await readRetentionCount();
	const backups = await enforceRetention(
		installFolderId,
		retention,
		token,
		deps,
	);

	await updateLocalIndex(installId, backups);
	await writeRetentionCount(retention);
	return backups;
}

/** Restore modes supported by Drive restore operations. */
export type RestoreFromBackupMode = "replace" | "merge";

/**
 * Optional restore behavior flags.
 * This remains an options bag so older callers keep the original replace
 * behavior without any call-site changes.
 */
export type RestoreFromBackupOptions = {
	mode?: RestoreFromBackupMode;
};

/**
 * Downloads a backup file from Drive, validates payload shape, then restores
 * local saved tabs. Settings remain sourced from extension storage only.
 */
export async function restoreFromBackup(
	fileId: string,
	token: string,
	deps: Pick<DriveApiDeps, "downloadJsonFile"> = defaultDeps,
	options: RestoreFromBackupOptions = {},
): Promise<{ restoredGroups: number; restoredTabs: number }> {
	const rawPayload = await deps.downloadJsonFile(fileId, token);
	if (!rawPayload || typeof rawPayload !== "object") {
		throw new Error("Backup payload is not an object.");
	}

	const payload = rawPayload as {
		savedTabs?: unknown;
		groupMetadata?: unknown;
		savedTabGroupMetadata?: unknown;
	};
	const savedTabsRaw = payload.savedTabs;
	const incomingGroups = normalizeSavedGroups(savedTabsRaw);
	const incomingMetadata = filterSavedGroupMetadataForKeys(
		normalizeSavedGroupMetadata(payload.groupMetadata ?? payload.savedTabGroupMetadata),
		Object.keys(incomingGroups),
	);
	const restoreMode = options.mode ?? "replace";
	/**
	 * Merge restore shares one duplicate-URL index across the entire operation.
	 * That keeps the work linear in total tab count instead of repeatedly
	 * scanning previously merged groups for every incoming tab.
	 */
	let groups = incomingGroups;
	let groupMetadata = incomingMetadata;
	if (restoreMode === "merge") {
		const [existingGroups, existingMetadata, currentSettings] = await Promise.all([
			readSavedGroups(),
			readSavedGroupMetadata(),
			readSettings(),
		]);
		groups = mergeGroups(
			existingGroups,
			incomingGroups,
			currentSettings.duplicateTabsPolicy,
		);
		groupMetadata = mergeGroupMetadata(existingMetadata, incomingMetadata, groups);
	}

	const savedGroups = await writeSavedGroups(groups, groupMetadata);
	if (!savedGroups) {
		throw new Error("Failed to write restored tab groups to local storage.");
	}

	const restoredGroups = Object.keys(groups).length;
	const restoredTabs = Object.values(groups).reduce(
		(total, tabs) => total + tabs.length,
		0,
	);
	return { restoredGroups, restoredTabs };
}

/**
 * Helper used by UI code: reads local index and falls back to Drive listing
 * when local cache is empty/missing.
 */
export async function getBackupsWithFallback(
	token: string,
	deps: DriveApiDeps = defaultDeps,
): Promise<DriveBackupEntry[]> {
	const local = await readLocalIndex();
	if (local.backups.length > 0) return local.backups;

	try {
		return await listDriveBackups(token, deps);
	} catch (error) {
		logExtensionError("Failed to list Drive backups as fallback", error, {
			operation: "runtime_context",
		});
		return [];
	}
}
