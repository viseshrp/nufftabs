import { describe, expect, it } from 'vitest';
import { appendTabsByDuplicatePolicy, collectSavedTabUrls } from '../../entrypoints/shared/duplicates';

describe('duplicates utilities', () => {
  it('collects unique URLs across all groups', () => {
    const urls = collectSavedTabUrls({
      one: [
        { id: '1', url: 'https://a.com', title: 'A', savedAt: 1 },
        { id: '2', url: 'https://b.com', title: 'B', savedAt: 1 },
      ],
      two: [{ id: '3', url: 'https://a.com', title: 'A2', savedAt: 2 }],
    });
    expect(Array.from(urls).sort()).toEqual(['https://a.com', 'https://b.com']);
  });

  it('appends all incoming tabs when duplicate policy is allow', () => {
    const result = appendTabsByDuplicatePolicy(
      [{ id: '1', url: 'https://a.com', title: 'A', savedAt: 1 }],
      [{ id: '2', url: 'https://a.com', title: 'Dup A', savedAt: 2 }],
      'allow',
    );
    expect(result.addedCount).toBe(1);
    expect(result.tabs).toHaveLength(2);
  });

  it('rejects duplicate URLs when duplicate policy is reject', () => {
    const knownUrls = new Set<string>(['https://a.com']);
    const result = appendTabsByDuplicatePolicy(
      [{ id: '1', url: 'https://a.com', title: 'A', savedAt: 1 }],
      [
        { id: '2', url: 'https://a.com', title: 'Dup A', savedAt: 2 },
        { id: '3', url: 'https://b.com', title: 'B', savedAt: 3 },
      ],
      'reject',
      knownUrls,
    );
    expect(result.addedCount).toBe(1);
    expect(result.tabs).toHaveLength(2);
    expect(knownUrls.has('https://b.com')).toBe(true);
  });

  it('throws when reject mode is used without known URL index', () => {
    expect(() =>
      appendTabsByDuplicatePolicy(
        [{ id: '1', url: 'https://a.com', title: 'A', savedAt: 1 }],
        [{ id: '2', url: 'https://b.com', title: 'B', savedAt: 2 }],
        'reject',
      ),
    ).toThrow('knownUrls is required');
  });

  it('returns existing tabs unchanged when incoming tabs are empty', () => {
    const existing = [{ id: '1', url: 'https://a.com', title: 'A', savedAt: 1 }];
    const result = appendTabsByDuplicatePolicy(existing, [], 'allow');
    expect(result.addedCount).toBe(0);
    expect(result.tabs).toEqual(existing);
  });
});
