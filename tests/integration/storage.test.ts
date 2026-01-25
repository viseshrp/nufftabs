import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  readSavedGroup,
  readSavedGroups,
  readSettings,
  writeSavedGroup,
  writeSavedGroups,
  writeSettings,
  type SavedTabGroups,
} from '../../entrypoints/shared/storage';
import { createMockChrome } from '../helpers/mock_chrome';

const makeTab = (id: string) => ({ id, url: `https://example.com/${id}`, title: id, savedAt: 10 });

describe('storage integration', () => {
  beforeEach(() => {
    const mock = createMockChrome();
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;
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

  it('reads and writes settings with defaults', async () => {
    const settings = await readSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);

    const saved = await writeSettings({ excludePinned: false, restoreBatchSize: 42 });
    expect(saved).toBe(true);

    const updated = await readSettings();
    expect(updated.excludePinned).toBe(false);
    expect(updated.restoreBatchSize).toBe(42);
  });

  it('returns safe defaults when storage throws', async () => {
    const mock = createMockChrome();
    // @ts-expect-error - test shim
    globalThis.chrome = mock.chrome;

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
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
