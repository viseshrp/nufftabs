import { describe, expect, it } from "vitest";
import {
	enforceRetention,
	getBackupsWithFallback,
	getOrCreateInstallId,
	listDriveBackups,
	listDriveBackupsPage,
	performBackup,
	readLocalIndex,
	readRetentionCount,
	restoreFromBackup,
	serializeBackup,
	updateLocalIndex,
	writeRetentionCount,
} from "../../entrypoints/drive/drive_backup";
import {
	BACKUP_VERSION,
	DRIVE_STORAGE_KEYS,
	createBackupFileName,
	extractTabGroupCountFromFileName,
	normalizeRetentionCount,
	parseDriveTimestamp,
} from "../../entrypoints/drive/types";
import {
	STORAGE_KEYS,
	savedGroupMetadataStorageKey,
} from "../../entrypoints/shared/storage";
import { createMockChrome, setMockChrome } from "../helpers/mock_chrome";

describe("drive backup utilities", () => {
	it("creates and reuses install id", async () => {
		const mock = createMockChrome();
		setMockChrome(mock.chrome);

		const generated = await getOrCreateInstallId();
		const second = await getOrCreateInstallId();

		expect(typeof generated).toBe("string");
		expect(generated.length).toBeGreaterThan(0);
		expect(second).toBe(generated);
		expect(mock.storageData[DRIVE_STORAGE_KEYS.installId]).toBe(generated);
	});

	it("serializes backup payload with expected shape", () => {
		const payload = serializeBackup(
			{
				g1: [
					{
						id: "1",
						url: "https://example.com",
						title: "Example",
						savedAt: 1700000000000,
					},
				],
			},
			1700000000000,
			{ g1: { pinned: true }, stale: { pinned: true } },
		);

		expect(payload.version).toBe(BACKUP_VERSION);
		expect(payload.timestamp).toBe(1700000000000);
		expect(Object.keys(payload.savedTabs)).toEqual(["g1"]);
		expect(payload.groupMetadata).toEqual({ g1: { pinned: true } });
		expect(Object.keys(payload)).toEqual(["version", "timestamp", "savedTabs", "groupMetadata"]);
		expect("settings" in payload).toBe(false);
		expect("installId" in payload).toBe(false);
	});

	it("normalizes retention and backup filename helpers", () => {
		const fileName = createBackupFileName(1700000000000, 12);

		expect(fileName).toContain("nufftabs-backup-");
		expect(fileName).toContain("-g12.json");
		expect(extractTabGroupCountFromFileName(fileName)).toBe(12);
		expect(extractTabGroupCountFromFileName("nope.json")).toBe(0);

		expect(normalizeRetentionCount(0)).toBe(1);
		expect(normalizeRetentionCount(9999)).toBe(500);
		expect(normalizeRetentionCount(42)).toBe(42);
		expect(parseDriveTimestamp("invalid")).toBe(0);
		expect(parseDriveTimestamp("")).toBe(0);
		expect(extractTabGroupCountFromFileName("backup-a-g0.json")).toBe(0);
	});

	it("reads and writes local backup index with normalization", async () => {
		const mock = createMockChrome({
			initialStorage: {
				[DRIVE_STORAGE_KEYS.installId]: "install-1",
				[DRIVE_STORAGE_KEYS.driveBackupIndex]: {
					installId: "install-1",
					backups: [
						{
							fileId: "f1",
							fileName: "backup-a.json",
							timestamp: 10,
							size: 123,
							tabGroupCount: 4,
						},
						{
							fileId: "",
							fileName: "invalid.json",
							timestamp: 5,
							size: 1,
							tabGroupCount: 1,
						},
					],
				},
			},
		});
		setMockChrome(mock.chrome);

		const read = await readLocalIndex();
		expect(read.installId).toBe("install-1");
		expect(read.backups).toHaveLength(1);

		await updateLocalIndex("install-1", [
			{
				fileId: "f2",
				fileName: "backup-b.json",
				timestamp: 20,
				size: 222,
				tabGroupCount: 2,
			},
		]);

		const stored = mock.storageData[DRIVE_STORAGE_KEYS.driveBackupIndex] as {
			installId: string;
			backups: Array<{ fileId: string }>;
		};
		expect(stored.installId).toBe("install-1");
		expect(stored.backups[0].fileId).toBe("f2");
	});

	it("handles retention read/write and enforceRetention trimming", async () => {
		const mock = createMockChrome();
		setMockChrome(mock.chrome);

		expect(await readRetentionCount()).toBe(10);
		const saved = await writeRetentionCount(2);
		expect(saved).toBe(2);

		const deleted: string[] = [];
		const kept = await enforceRetention("folder-1", 2, "token-1", {
			listFiles: async () => [
				{
					id: "a",
					name: "backup-1-g2.json",
					createdTime: "2024-01-03T10:00:00.000Z",
					size: "10",
				},
				{
					id: "b",
					name: "backup-2-g1.json",
					createdTime: "2024-01-02T10:00:00.000Z",
					size: "10",
				},
				{
					id: "c",
					name: "backup-3-g1.json",
					createdTime: "2024-01-01T10:00:00.000Z",
					size: "10",
				},
			],
			deleteFile: async (fileId: string) => {
				deleted.push(fileId);
			},
		});

		expect(kept).toHaveLength(2);
		expect(deleted).toEqual(["c"]);
	});

	it("lists drive backups and updates local index", async () => {
		const mock = createMockChrome();
		setMockChrome(mock.chrome);

		const backups = await listDriveBackups("token-1", {
			getOrCreateFolder: async (name: string) => `${name}-id`,
			listFiles: async () => [
				{
					id: "f1",
					name: "backup-z-g5.json",
					createdTime: "2024-01-01T00:00:00.000Z",
					size: "42",
				},
			],
			uploadJsonFile: async () => {
				throw new Error("not used");
			},
			downloadJsonFile: async () => {
				throw new Error("not used");
			},
			deleteFile: async () => {
				throw new Error("not used");
			},
		});

		expect(backups).toHaveLength(1);
		expect(backups[0]?.fileId).toBe("f1");

		const stored = mock.storageData[DRIVE_STORAGE_KEYS.driveBackupIndex] as {
			backups: Array<{ fileId: string }>;
		};
		expect(stored.backups[0]?.fileId).toBe("f1");
	});

	it("lists a single backup page using Drive page API when available", async () => {
		const mock = createMockChrome();
		setMockChrome(mock.chrome);

		const page = await listDriveBackupsPage("token-1", undefined, 25, {
			getOrCreateFolder: async (name: string) => `${name}-id`,
			listFilesPage: async () => ({
				files: [
					{
						id: "f1",
						name: "backup-z-g5.json",
						createdTime: "2024-01-01T00:00:00.000Z",
						size: "42",
					},
				],
				nextPageToken: "next-1",
			}),
			listFiles: async () => {
				throw new Error("not used");
			},
		});

		expect(page.backups).toHaveLength(1);
		expect(page.backups[0]?.fileId).toBe("f1");
		expect(page.nextPageToken).toBe("next-1");
	});

	it("falls back to full list for first page when paged Drive API dep is absent", async () => {
		const mock = createMockChrome();
		setMockChrome(mock.chrome);

		const page = await listDriveBackupsPage("token-1", undefined, 25, {
			getOrCreateFolder: async (name: string) => `${name}-id`,
			listFiles: async () => [
				{
					id: "f1",
					name: "backup-z-g5.json",
					createdTime: "2024-01-01T00:00:00.000Z",
					size: "42",
				},
			],
		});

		expect(page.backups).toHaveLength(1);
		expect(page.backups[0]?.fileId).toBe("f1");
		expect(page.nextPageToken).toBeNull();
	});

	it("returns an empty page token response when paged dependency is absent on subsequent pages", async () => {
		const mock = createMockChrome();
		setMockChrome(mock.chrome);

		const page = await listDriveBackupsPage("token-1", "token-2", 25, {
			getOrCreateFolder: async (name: string) => `${name}-id`,
			listFiles: async () => {
				throw new Error("not used");
			},
		});

		expect(page.backups).toEqual([]);
		expect(page.nextPageToken).toBeNull();
	});

	it("performs backup, writes local index, and enforces retention", async () => {
		const mock = createMockChrome({
			initialStorage: {
				[STORAGE_KEYS.settings]: {
					excludePinned: false,
					restoreBatchSize: 50,
					discardRestoredTabs: true,
					duplicateTabsPolicy: "allow",
					theme: "dark",
				},
				[STORAGE_KEYS.savedTabsIndex]: ["g1"],
				"savedTabs:g1": [
					{ id: "1", url: "https://example.com", title: "Example", savedAt: 1 },
				],
				[STORAGE_KEYS.savedTabGroupMetadata]: { g1: { pinned: true } },
				[DRIVE_STORAGE_KEYS.installId]: "install-1",
			},
		});
		setMockChrome(mock.chrome);

		const uploads: Array<{ name: string; content: string }> = [];
		const deleted: string[] = [];

		const backups = await performBackup("token-1", 1, {
			getOrCreateFolder: async (name: string) => `${name}-id`,
			uploadJsonFile: async (name: string, content: string) => {
				uploads.push({ name, content });
				return {
					id: "new-file",
					name,
					createdTime: "2024-01-03T00:00:00.000Z",
					size: "100",
				};
			},
			listFiles: async () => [
				{
					id: "new-file",
					name: "backup-2024-01-03T00-00-00-000Z-g1.json",
					createdTime: "2024-01-03T00:00:00.000Z",
					size: "100",
				},
				{
					id: "old-file",
					name: "backup-2024-01-01T00-00-00-000Z-g1.json",
					createdTime: "2024-01-01T00:00:00.000Z",
					size: "90",
				},
			],
			downloadJsonFile: async () => {
				throw new Error("not used");
			},
			deleteFile: async (fileId: string) => {
				deleted.push(fileId);
			},
		});

		expect(uploads).toHaveLength(1);
		expect(uploads[0]?.name).toContain("nufftabs-backup-");
		expect(uploads[0]?.content).not.toContain('"installId"');
		expect(JSON.parse(uploads[0]?.content ?? "{}").groupMetadata).toEqual({
			g1: { pinned: true },
		});
		expect(backups).toHaveLength(1);
		expect(deleted).toEqual(["old-file"]);

		const storedIndex = mock.storageData[
			DRIVE_STORAGE_KEYS.driveBackupIndex
		] as {
			backups: Array<{ fileId: string }>;
		};
		expect(storedIndex.backups).toHaveLength(1);
		expect(storedIndex.backups[0]?.fileId).toBe("new-file");
	});

	it("performs backup using stored retention when request retention is omitted", async () => {
		const mock = createMockChrome({
			initialStorage: {
				[STORAGE_KEYS.settings]: {
					excludePinned: true,
					restoreBatchSize: 100,
					discardRestoredTabs: false,
					duplicateTabsPolicy: "allow",
					theme: "os",
				},
				[STORAGE_KEYS.savedTabsIndex]: ["g1"],
				"savedTabs:g1": [
					{ id: "1", url: "https://example.com", title: "Example", savedAt: 1 },
				],
				[DRIVE_STORAGE_KEYS.installId]: "install-1",
				[DRIVE_STORAGE_KEYS.retentionCount]: 2,
			},
		});
		setMockChrome(mock.chrome);

		const backups = await performBackup("token-1", undefined, {
			getOrCreateFolder: async (name: string) => `${name}-id`,
			uploadJsonFile: async (name: string) => ({ id: "new-file", name }),
			listFiles: async () => [
				{
					id: "new-file",
					name: "backup-2024-01-03T00-00-00-000Z-g1.json",
					modifiedTime: "2024-01-03T00:00:00.000Z",
				},
				{
					id: "old-file",
					name: "backup-2024-01-01T00-00-00-000Z-g1.json",
					modifiedTime: "2024-01-01T00:00:00.000Z",
				},
			],
			downloadJsonFile: async () => {
				throw new Error("not used");
			},
			deleteFile: async () => undefined,
		});

		expect(backups).toHaveLength(2);
	});

	it("restores backup payload into groups without changing settings", async () => {
		const mock = createMockChrome({
			initialStorage: {
				[STORAGE_KEYS.settings]: {
					excludePinned: true,
					restoreBatchSize: 100,
					discardRestoredTabs: false,
					duplicateTabsPolicy: "reject",
					theme: "os",
				},
			},
		});
		setMockChrome(mock.chrome);

		const result = await restoreFromBackup("file-1", "token-1", {
			downloadJsonFile: async () => ({
				version: 1,
				timestamp: 1,
				savedTabs: {
					restored: [
						{
							id: "1",
							url: "https://restored.com",
							title: "Restored",
							savedAt: 1,
						},
					],
				},
				groupMetadata: {
					restored: { pinned: true },
					stale: { pinned: true },
				},
			}),
		});

		expect(result.restoredGroups).toBe(1);
		expect(result.restoredTabs).toBe(1);

		const savedIndex = mock.storageData[
			STORAGE_KEYS.savedTabsIndex
		] as string[];
		expect(savedIndex).toEqual(["restored"]);
			expect(mock.storageData[savedGroupMetadataStorageKey("restored")]).toEqual({
				pinned: true,
			});

		const savedSettings = mock.storageData[STORAGE_KEYS.settings] as {
			restoreBatchSize: number;
			theme: string;
			duplicateTabsPolicy: string;
		};
		expect(savedSettings.restoreBatchSize).toBe(100);
		expect(savedSettings.theme).toBe("os");
		expect(savedSettings.duplicateTabsPolicy).toBe("reject");
	});

	it("ignores legacy install ids and settings present in older backup payloads", async () => {
		const mock = createMockChrome({
			initialStorage: {
				[STORAGE_KEYS.settings]: {
					excludePinned: true,
					restoreBatchSize: 100,
					discardRestoredTabs: false,
					duplicateTabsPolicy: "reject",
					theme: "os",
				},
			},
		});
		setMockChrome(mock.chrome);

		const result = await restoreFromBackup("file-1", "token-1", {
			downloadJsonFile: async () => ({
				version: 1,
				timestamp: 1,
				installId: "legacy-install-id",
				savedTabs: {
					restored: [
						{
							id: "1",
							url: "https://restored.com",
							title: "Restored",
							savedAt: 1,
						},
					],
				},
				settings: {
					excludePinned: false,
					restoreBatchSize: 77,
					discardRestoredTabs: true,
					duplicateTabsPolicy: "allow",
					theme: "light",
				},
			}),
		});

		expect(result.restoredGroups).toBe(1);
		expect(result.restoredTabs).toBe(1);

		const savedIndex = mock.storageData[
			STORAGE_KEYS.savedTabsIndex
		] as string[];
		expect(savedIndex).toEqual(["restored"]);

		const savedSettings = mock.storageData[STORAGE_KEYS.settings] as {
			restoreBatchSize: number;
			theme: string;
		};
		expect(savedSettings.restoreBatchSize).toBe(100);
		expect(savedSettings.theme).toBe("os");
	});

	it("merges restored backup groups into existing groups without replacing them", async () => {
		const mock = createMockChrome({
			initialStorage: {
				[STORAGE_KEYS.savedTabsIndex]: ["existing", "shared"],
				"savedTabs:existing": [
					{
						id: "1",
						url: "https://existing.com",
						title: "Existing",
						savedAt: 1,
					},
				],
				"savedTabs:shared": [
					{
						id: "2",
						url: "https://shared-existing.com",
						title: "Shared Existing",
						savedAt: 2,
					},
				],
				[STORAGE_KEYS.savedTabGroupMetadata]: { existing: { pinned: true } },
				[STORAGE_KEYS.settings]: {
					excludePinned: true,
					restoreBatchSize: 100,
					discardRestoredTabs: false,
					duplicateTabsPolicy: "reject",
					theme: "os",
				},
			},
		});
		setMockChrome(mock.chrome);

		const result = await restoreFromBackup(
			"file-1",
			"token-1",
			{
				downloadJsonFile: async () => ({
					version: 1,
					timestamp: 1,
					savedTabs: {
						shared: [
							{
								id: "3",
								url: "https://shared-existing.com",
								title: "Duplicate Shared",
								savedAt: 3,
							},
							{
								id: "4",
								url: "https://shared-new.com",
								title: "Shared New",
								savedAt: 4,
							},
						],
						restored: [
							{
								id: "5",
								url: "https://restored.com",
								title: "Restored",
								savedAt: 5,
							},
						],
					},
					groupMetadata: {
						shared: { pinned: true },
						restored: { pinned: true },
					},
				}),
			},
			{ mode: "merge" },
		);

		expect(result.restoredGroups).toBe(3);
		expect(result.restoredTabs).toBe(4);

		const savedIndex = mock.storageData[
			STORAGE_KEYS.savedTabsIndex
		] as string[];
		expect(savedIndex).toEqual(["existing", "shared", "restored"]);
			expect(mock.storageData[savedGroupMetadataStorageKey("existing")]).toEqual({
				pinned: true,
			});
			expect(mock.storageData[savedGroupMetadataStorageKey("shared")]).toEqual({
				pinned: true,
			});
			expect(mock.storageData[savedGroupMetadataStorageKey("restored")]).toEqual({
				pinned: true,
			});

		const existingGroup = mock.storageData["savedTabs:existing"] as Array<{
			url: string;
		}>;
		expect(existingGroup).toHaveLength(1);

		const sharedGroup = mock.storageData["savedTabs:shared"] as Array<{
			url: string;
		}>;
		expect(sharedGroup).toHaveLength(2);
		expect(sharedGroup[0]?.url).toBe("https://shared-existing.com");
		expect(sharedGroup[1]?.url).toBe("https://shared-new.com");

		const restoredGroup = mock.storageData["savedTabs:restored"] as Array<{
			url: string;
		}>;
		expect(restoredGroup).toHaveLength(1);
		expect(restoredGroup[0]?.url).toBe("https://restored.com");

		const savedSettings = mock.storageData[STORAGE_KEYS.settings] as {
			restoreBatchSize: number;
			theme: string;
			duplicateTabsPolicy: string;
		};
		expect(savedSettings.restoreBatchSize).toBe(100);
		expect(savedSettings.theme).toBe("os");
		expect(savedSettings.duplicateTabsPolicy).toBe("reject");
	});

	it("fails restore when writing groups fails", async () => {
		const mock = createMockChrome();
		setMockChrome(mock.chrome);

		mock.chrome.storage.local.set = async () => {
			throw new Error("boom");
		};

		await expect(
			restoreFromBackup("file-1", "token-1", {
				downloadJsonFile: async () => ({
					savedTabs: { restored: [{ url: "https://restored.com" }] },
				}),
			}),
		).rejects.toThrow("Failed to write restored tab groups");
	});

	it("uses local backup index first and falls back when empty", async () => {
		const mock = createMockChrome({
			initialStorage: {
				[DRIVE_STORAGE_KEYS.driveBackupIndex]: {
					installId: "install-1",
					backups: [
						{
							fileId: "local",
							fileName: "backup-local.json",
							timestamp: 2,
							size: 1,
							tabGroupCount: 1,
						},
					],
				},
			},
		});
		setMockChrome(mock.chrome);

		const localFirst = await getBackupsWithFallback("token-1");
		expect(localFirst).toHaveLength(1);
		expect(localFirst[0]?.fileId).toBe("local");

		mock.storageData[DRIVE_STORAGE_KEYS.driveBackupIndex] = {
			installId: "install-1",
			backups: [],
		};

		const fromDrive = await getBackupsWithFallback("token-1", {
			getOrCreateFolder: async (name: string) => `${name}-id`,
			listFiles: async () => [
				{
					id: "drive-1",
					name: "backup-drive.json",
					createdTime: "2024-01-02T00:00:00.000Z",
					size: "9",
				},
			],
			uploadJsonFile: async () => {
				throw new Error("not used");
			},
			downloadJsonFile: async () => {
				throw new Error("not used");
			},
			deleteFile: async () => {
				throw new Error("not used");
			},
		});
		expect(Array.isArray(fromDrive)).toBe(true);
		expect(fromDrive[0]?.fileId).toBe("drive-1");
	});

	it("returns empty fallback list when drive listing throws", async () => {
		const mock = createMockChrome({
			initialStorage: {
				[DRIVE_STORAGE_KEYS.driveBackupIndex]: {
					installId: "install-1",
					backups: [],
				},
			},
		});
		setMockChrome(mock.chrome);

		const backups = await getBackupsWithFallback("token-1", {
			getOrCreateFolder: async () => {
				throw new Error("fail");
			},
			listFiles: async () => [],
			uploadJsonFile: async () => {
				throw new Error("not used");
			},
			downloadJsonFile: async () => {
				throw new Error("not used");
			},
			deleteFile: async () => {
				throw new Error("not used");
			},
		});

		expect(backups).toEqual([]);
	});

	it("throws on malformed restore payload", async () => {
		const mock = createMockChrome();
		setMockChrome(mock.chrome);

		await expect(
			restoreFromBackup("file-1", "token-1", {
				downloadJsonFile: async () => "invalid",
			}),
		).rejects.toThrow("Backup payload is not an object.");
	});
});
