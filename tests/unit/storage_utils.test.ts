import { describe, expect, it, vi } from 'vitest';
import {
  createSavedTab,
  filterSavedGroupMetadataForKeys,
  isSavedGroupMetadataStorageKey,
  isSavedGroupStorageKey,
  normalizeSavedGroupMetadata,
  normalizeSavedGroups,
  normalizeSettings,
  savedGroupMetadataStorageKey,
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
      duplicateTabsPolicy: 'invalid',
    });
    expect(normalized.restoreBatchSize).toBeGreaterThan(0);
    expect(normalized.discardRestoredTabs).toBe(false);
    expect(normalized.duplicateTabsPolicy).toBe('allow');
    expect(isSavedGroupStorageKey('savedTabs:123')).toBe(true);
    expect(savedGroupMetadataStorageKey('123')).toBe('savedTabGroupMetadata:123');
    expect(isSavedGroupMetadataStorageKey('savedTabGroupMetadata:123')).toBe(true);
    expect(isSavedGroupStorageKey('settings')).toBe(false);
  });

  it('normalizes and filters pinned group metadata', () => {
    const normalized = normalizeSavedGroupMetadata({
      pinned: { pinned: true },
      compact: true,
      unpinned: { pinned: false },
      invalid: { other: true },
    });

    expect(normalized).toEqual({
      pinned: { pinned: true },
      compact: { pinned: true },
    });

    // Filtering metadata at write boundaries keeps deleted groups from retaining stale pins.
    expect(filterSavedGroupMetadataForKeys(normalized, ['compact'])).toEqual({
      compact: { pinned: true },
    });
  });
});
