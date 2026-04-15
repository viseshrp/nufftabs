import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  appendSavedGroup,
  readSavedGroup,
  readSavedGroupMetadata,
  readSavedGroups,
  readSavedGroupsIndex,
  readSettings,
  savedGroupMetadataStorageKey,
  writeSavedGroup,
  writeSavedGroupPinned,
  writeSavedGroups,
  writeSettings,
  type SavedTabGroups,
} from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

const makeTab = (id: string) => ({ id, url: `https://example.com/${id}`, title: id, savedAt: 10 });
let currentMock: ReturnType<typeof createMockChrome>;

/** Reads raw mock storage so tests can verify the physical key layout. */
function mockChromeStorageValue(key: string): unknown {
  return currentMock.storageData[key];
}

describe('storage integration', () => {
  beforeEach(() => {
    currentMock = createMockChrome();
    setMockChrome(currentMock.chrome);
  });

  it('writes and reads a single group with index updates', async () => {
    const saved = await writeSavedGroup('1', [makeTab('a'), makeTab('b')]);
    expect(saved).toBe(true);

    const group = await readSavedGroup('1');
    expect(group).toHaveLength(2);

    const groups = await readSavedGroups();
    expect(Object.keys(groups)).toEqual(['1']);

    const cleared = await writeSavedGroup('1', []);
    expect(cleared).toBe(true);
    expect(await readSavedGroups()).toEqual({});
  });

  it('writes and reads multiple groups', async () => {
    const payload: SavedTabGroups = {
      one: [makeTab('1')],
      two: [makeTab('2'), makeTab('3')],
    };
    expect(await writeSavedGroups(payload)).toBe(true);
    const groups = await readSavedGroups();
    expect(Object.keys(groups).sort()).toEqual(['one', 'two']);
  });

  it('removes stale groups when overwriting saved groups', async () => {
    const payload: SavedTabGroups = {
      one: [makeTab('1')],
      two: [makeTab('2')],
    };
    expect(await writeSavedGroups(payload)).toBe(true);
    expect(await writeSavedGroups({ one: [makeTab('1')] })).toBe(true);
    const groups = await readSavedGroups();
    expect(Object.keys(groups)).toEqual(['one']);
  });

  it('discovers active groups from physical group keys when the compatibility index is stale', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: ['one'],
        'savedTabs:one': [makeTab('1')],
        'savedTabs:two': [makeTab('2')],
      },
    });
    setMockChrome(mock.chrome);

    expect((await readSavedGroupsIndex()).sort()).toEqual(['one', 'two']);
    expect(Object.keys(await readSavedGroups()).sort()).toEqual(['one', 'two']);
  });

  it('falls back to the compatibility index when key enumeration is unavailable', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: ['legacy'],
        'savedTabs:legacy': [makeTab('legacy')],
      },
    });
    setMockChrome(mock.chrome);
    const storageArea: { getKeys?: () => Promise<string[]> } = mock.chrome.storage.local;
    delete storageArea.getKeys;

    expect(await readSavedGroupsIndex()).toEqual(['legacy']);
    expect(Object.keys(await readSavedGroups())).toEqual(['legacy']);
  });

  it('keeps concurrent group adds discoverable even if the index mirror loses one add', async () => {
    const originalGetKeys = currentMock.chrome.storage.local.getKeys;
    let readCount = 0;
    currentMock.chrome.storage.local.getKeys = async () => {
      readCount += 1;
      return readCount <= 2 ? [] : originalGetKeys();
    };

    await Promise.all([writeSavedGroup('one', [makeTab('1')]), writeSavedGroup('two', [makeTab('2')])]);

    expect(Object.keys(await readSavedGroups()).sort()).toEqual(['one', 'two']);
    expect(mockChromeStorageValue(STORAGE_KEYS.savedTabsIndex)).toEqual(['two']);
  });

  it('keeps a concurrently added group visible when another group is deleted', async () => {
    expect(await writeSavedGroup('one', [makeTab('1')])).toBe(true);

    const originalSet = currentMock.chrome.storage.local.set;
    let injectedConcurrentAdd = false;
    currentMock.chrome.storage.local.set = async (payload) => {
      if (!injectedConcurrentAdd && STORAGE_KEYS.savedTabsIndex in payload && !('savedTabs:two' in payload)) {
        injectedConcurrentAdd = true;
        await originalSet({
          [STORAGE_KEYS.savedTabsIndex]: ['one', 'two'],
          'savedTabs:two': [makeTab('2')],
        });
      }
      await originalSet(payload);
    };

    expect(await writeSavedGroup('one', [])).toBe(true);

    expect(Object.keys(await readSavedGroups())).toEqual(['two']);
    expect(mockChromeStorageValue(STORAGE_KEYS.savedTabsIndex)).toEqual([]);
  });

  it('rewrites groups without clobbering independent metadata keys', async () => {
    const payload: SavedTabGroups = {
      one: [makeTab('1')],
      two: [makeTab('2')],
    };
    expect(await writeSavedGroups(payload, { two: { pinned: true } })).toBe(true);

    // Bulk rewrites without explicit metadata should not read and rewrite pin metadata.
    expect(await writeSavedGroups({ one: [makeTab('updated')], two: [makeTab('2')] })).toBe(true);

    expect(mockChromeStorageValue(savedGroupMetadataStorageKey('two'))).toEqual({ pinned: true });
    expect(mockChromeStorageValue(STORAGE_KEYS.savedTabGroupMetadata)).toBeUndefined();
  });

  it('persists group pin metadata and prunes it when groups are removed', async () => {
    const payload: SavedTabGroups = {
      one: [makeTab('1')],
      two: [makeTab('2')],
    };
    expect(await writeSavedGroups(payload, { one: { pinned: true }, missing: { pinned: true } })).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({ one: { pinned: true } });
    expect(mockChromeStorageValue(savedGroupMetadataStorageKey('one'))).toEqual({ pinned: true });
    expect(mockChromeStorageValue(savedGroupMetadataStorageKey('missing'))).toBeUndefined();

    expect(await writeSavedGroupPinned('two', true)).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({
      one: { pinned: true },
      two: { pinned: true },
    });
    expect(mockChromeStorageValue(savedGroupMetadataStorageKey('two'))).toEqual({ pinned: true });

    expect(await writeSavedGroup('one', [])).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({ two: { pinned: true } });
    expect(mockChromeStorageValue(savedGroupMetadataStorageKey('one'))).toBeUndefined();

    expect(await writeSavedGroups({})).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({});
    expect(mockChromeStorageValue(savedGroupMetadataStorageKey('two'))).toBeUndefined();
  });

  it('handles group pin metadata edge cases safely', async () => {
    const payload: SavedTabGroups = {
      one: [makeTab('1')],
      two: [makeTab('2')],
    };
    expect(await writeSavedGroups(payload, { one: { pinned: true } })).toBe(true);

    // Unpinning writes a tombstone so old aggregate-map pins cannot reappear.
    expect(await writeSavedGroupPinned('one', false)).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({});
    expect(mockChromeStorageValue(savedGroupMetadataStorageKey('one'))).toEqual({ pinned: false });

    // Missing groups cannot be pinned because metadata must stay tied to the saved-group index.
    expect(await writeSavedGroupPinned('missing', true)).toBe(false);
  });

  it('reads legacy metadata while per-group tombstones override old pins', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: ['legacy', 'unpinned'],
        'savedTabs:legacy': [makeTab('legacy')],
        'savedTabs:unpinned': [makeTab('unpinned')],
        [STORAGE_KEYS.savedTabGroupMetadata]: {
          legacy: { pinned: true },
          unpinned: { pinned: true },
        },
        [savedGroupMetadataStorageKey('unpinned')]: { pinned: false },
      },
    });
    setMockChrome(mock.chrome);

    expect(await readSavedGroupMetadata()).toEqual({ legacy: { pinned: true } });
  });

  it('returns empty group metadata when metadata reads fail', async () => {
    const mock = createMockChrome({
      initialStorage: {
        'savedTabs:one': [makeTab('1')],
      },
    });
    setMockChrome(mock.chrome);
    mock.chrome.storage.local.get = async () => {
      throw new Error('boom');
    };

    expect(await readSavedGroupMetadata()).toEqual({});
  });

  it('returns false when writing group pin metadata fails', async () => {
    const mock = createMockChrome({
      initialStorage: {
        [STORAGE_KEYS.savedTabsIndex]: ['one'],
        'savedTabs:one': [makeTab('1')],
        [STORAGE_KEYS.savedTabGroupMetadata]: { one: { pinned: true } },
      },
    });
    setMockChrome(mock.chrome);
    mock.chrome.storage.local.set = async () => {
      throw new Error('boom');
    };

    expect(await writeSavedGroupPinned('one', false)).toBe(false);
  });

  it('appends groups without clobbering existing ones', async () => {
    expect(await writeSavedGroup('one', [makeTab('1')])).toBe(true);
    expect(await appendSavedGroup('two', [makeTab('2')])).toBe(true);
    expect(await appendSavedGroup('two', [makeTab('2')])).toBe(true);
    const groups = await readSavedGroups();
    expect(Object.keys(groups).sort()).toEqual(['one', 'two']);
  });

  it('returns false when appending an empty group', async () => {
    expect(await appendSavedGroup('empty', [])).toBe(false);
  });

  it('reads and writes settings with defaults', async () => {
    const settings = await readSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);

    const saved = await writeSettings({
      excludePinned: false,
      restoreBatchSize: 42,
      discardRestoredTabs: true,
      duplicateTabsPolicy: 'reject',
    });
    expect(saved).toBe(true);

    const updated = await readSettings();
    expect(updated.excludePinned).toBe(false);
    expect(updated.restoreBatchSize).toBe(42);
    expect(updated.discardRestoredTabs).toBe(true);
    expect(updated.duplicateTabsPolicy).toBe('reject');
  });

  it('returns safe defaults when storage throws', async () => {
    const mock = createMockChrome({
      initialStorage: {
        'savedTabs:1': [makeTab('a')],
      },
    });
    setMockChrome(mock.chrome);

    mock.chrome.storage.local.get = async () => {
      throw new Error('boom');
    };
    mock.chrome.storage.local.set = async () => {
      throw new Error('boom');
    };
    mock.chrome.storage.local.remove = async () => {
      throw new Error('boom');
    };

    expect(await readSavedGroups()).toEqual({});
    expect(await readSavedGroup('1')).toEqual([]);
    expect(await writeSavedGroup('1', [makeTab('a')])).toBe(false);
    expect(await writeSavedGroups({ one: [makeTab('1')] })).toBe(false);
    expect(await appendSavedGroup('one', [makeTab('1')])).toBe(false);
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
