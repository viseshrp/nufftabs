import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  appendSavedGroup,
  readSavedGroup,
  readSavedGroupMetadata,
  readSavedGroups,
  readSettings,
  writeSavedGroup,
  writeSavedGroupPinned,
  writeSavedGroups,
  writeSettings,
  type SavedTabGroups,
} from '../../entrypoints/shared/storage';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

const makeTab = (id: string) => ({ id, url: `https://example.com/${id}`, title: id, savedAt: 10 });

describe('storage integration', () => {
  beforeEach(() => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);
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

  it('persists group pin metadata and prunes it when groups are removed', async () => {
    const payload: SavedTabGroups = {
      one: [makeTab('1')],
      two: [makeTab('2')],
    };
    expect(await writeSavedGroups(payload, { one: { pinned: true }, missing: { pinned: true } })).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({ one: { pinned: true } });

    expect(await writeSavedGroupPinned('two', true)).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({
      one: { pinned: true },
      two: { pinned: true },
    });

    expect(await writeSavedGroup('one', [])).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({ two: { pinned: true } });

    expect(await writeSavedGroups({})).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({});
  });

  it('handles group pin metadata edge cases safely', async () => {
    const payload: SavedTabGroups = {
      one: [makeTab('1')],
      two: [makeTab('2')],
    };
    expect(await writeSavedGroups(payload, { one: { pinned: true } })).toBe(true);

    // Unpinning deletes the compact metadata entry instead of storing explicit false values.
    expect(await writeSavedGroupPinned('one', false)).toBe(true);
    expect(await readSavedGroupMetadata()).toEqual({});

    // Missing groups cannot be pinned because metadata must stay tied to the saved-group index.
    expect(await writeSavedGroupPinned('missing', true)).toBe(false);
  });

  it('returns empty group metadata when metadata reads fail', async () => {
    const mock = createMockChrome();
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
    const mock = createMockChrome();
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
