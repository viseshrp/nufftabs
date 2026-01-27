import { describe, expect, it } from 'vitest';
import { parseOneTabExport } from '../../entrypoints/nufftabs/onetab_import';

describe('parseOneTabExport', () => {
  it('parses allowed URLs and skips invalid lines', () => {
    const text = [
      'https://example.com | Example',
      'invalid-url | Bad',
      'chrome://extensions | Extensions',
      '  ',
      'file:///Users/test/index.html | File',
    ].join('\n');

    const result = parseOneTabExport(text);
    expect(result.totalLines).toBe(4);
    expect(result.tabs).toHaveLength(3);
    expect(result.tabs[0]?.url).toBe('https://example.com');
    expect(result.tabs[1]?.url).toBe('chrome://extensions');
  });
});
