import { describe, expect, it } from 'vitest';
import {
  areGroupsEquivalent,
  countTotalTabs,
  formatCreatedAt,
  getGroupCreatedAt,
  isSameGroup,
  mergeGroups,
  normalizeImportedGroups,
  normalizeTabArray,
} from '../../entrypoints/nufftabs/list';

const sampleTabs = [
  { id: '1', url: 'https://a.com', title: 'A', savedAt: 10 },
  { id: '2', url: 'https://b.com', title: 'B', savedAt: 20 },
];

describe('list', () => {
  it('counts total tabs across groups', () => {
    const firstTab = sampleTabs[0];
    if (!firstTab) throw new Error('Missing sample tab');
    expect(countTotalTabs({})).toBe(0);
    expect(countTotalTabs({ one: sampleTabs, two: [firstTab] })).toBe(3);
  });

  it('compares groups with heuristic', () => {
    expect(isSameGroup(sampleTabs, sampleTabs)).toBe(true);
    expect(isSameGroup(sampleTabs, [...sampleTabs].reverse())).toBe(false);
    expect(isSameGroup(undefined, sampleTabs)).toBe(false);
    expect(isSameGroup([], [])).toBe(true);
    expect(isSameGroup(sampleTabs, sampleTabs.slice(0, 1))).toBe(false);
    expect(
      areGroupsEquivalent({ one: sampleTabs }, { one: [...sampleTabs] }),
    ).toBe(true);
    expect(
      areGroupsEquivalent({ one: sampleTabs }, { one: [...sampleTabs].reverse() }),
    ).toBe(false);
    expect(areGroupsEquivalent({ one: sampleTabs }, { one: sampleTabs, two: [] })).toBe(false);
  });

  it('calculates group created at timestamps', () => {
    expect(getGroupCreatedAt(sampleTabs)).toBe(10);
    expect(Number.isFinite(getGroupCreatedAt([]))).toBe(false);
    expect(getGroupCreatedAt([{ id: 'x', url: 'https://x.com', title: 'X' } as const])).toBe(
      Number.NEGATIVE_INFINITY,
    );
    expect(formatCreatedAt(1700000000000)).toContain('2023');
  });

  it('normalizes imported groups from array and object', () => {
    const arrayPayload = [{ url: 'https://a.com' }];
    const normalizedArray = normalizeImportedGroups(arrayPayload, 'fallback');
    expect(normalizedArray?.fallback).toHaveLength(1);

    const objectPayload = { savedTabs: { win: [{ url: 'https://b.com', title: 'B' }] } };
    const normalizedObject = normalizeImportedGroups(objectPayload, 'fallback');
    expect(normalizedObject?.win?.[0]?.url).toBe('https://b.com');

    expect(normalizeImportedGroups({ invalid: true }, 'fallback')).toBeNull();
    expect(normalizeImportedGroups([], 'fallback')).toEqual({});
    expect(normalizeImportedGroups({ savedTabs: { empty: [] } }, 'fallback')).toEqual({});
    expect(normalizeImportedGroups([{ title: 'Missing URL' }], 'fallback')).toBeNull();
    expect(normalizeImportedGroups('bad', 'fallback')).toBeNull();
  });

  it('returns null for invalid tab arrays', () => {
    expect(normalizeTabArray([{ title: 'Missing URL' }])).toBeNull();
    expect(normalizeTabArray([null])).toBeNull();
    expect(normalizeTabArray('nope')).toBeNull();
    const normalized = normalizeTabArray([{ url: 'https://ok.com', savedAt: 'bad' }]);
    expect(normalized?.[0]?.url).toBe('https://ok.com');
    const normalizedWithFallbacks = normalizeTabArray([{ url: 'https://fallback.com', id: '', title: '' }]);
    expect(normalizedWithFallbacks?.[0]?.title).toBe('https://fallback.com');
  });

  it('merges groups by appending', () => {
    const firstTab = sampleTabs[0];
    if (!firstTab) throw new Error('Missing sample tab');
    const merged = mergeGroups(
      { one: sampleTabs },
      { one: [{ id: '3', url: 'https://c.com', title: 'C', savedAt: 30 }] },
    );
    expect(merged.one).toHaveLength(3);

    const mergedNew = mergeGroups({}, { two: [firstTab] });
    expect(mergedNew.two).toHaveLength(1);

    const mergedSkip = mergeGroups({ one: sampleTabs }, { empty: [] });
    expect(mergedSkip.empty).toBeUndefined();
  });
});
