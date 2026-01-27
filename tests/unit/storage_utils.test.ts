import { describe, expect, it, vi } from 'vitest';
import {
  createSavedTab,
  isSavedGroupStorageKey,
  normalizeSavedGroups,
  normalizeSettings,
} from '../../entrypoints/shared/storage';

describe('storage utilities', () => {
  it('creates saved tabs with defaults', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => 'uuid',
    });
    const tab = createSavedTab({ url: 'https://example.com' });
    expect(tab.id).toBe('uuid');
    expect(tab.title).toBe('https://example.com');
    vi.unstubAllGlobals();
  });

  it('normalizes groups from arrays and objects', () => {
    const arrayGroups = normalizeSavedGroups([{ url: 'https://a.com' }], 'fallback');
    expect(arrayGroups.fallback).toHaveLength(1);

    const objectGroups = normalizeSavedGroups({ one: [{ url: 'https://b.com' }] });
    expect(objectGroups.one).toHaveLength(1);
    expect(normalizeSavedGroups({ one: [] })).toEqual({});
  });

  it('normalizes settings and storage keys', () => {
    const normalized = normalizeSettings({
      excludePinned: false,
      restoreBatchSize: -1,
      discardRestoredTabs: 'nope',
    });
    expect(normalized.restoreBatchSize).toBeGreaterThan(0);
    expect(normalized.discardRestoredTabs).toBe(false);
    expect(isSavedGroupStorageKey('savedTabs:123')).toBe(true);
    expect(isSavedGroupStorageKey('settings')).toBe(false);
  });
});
