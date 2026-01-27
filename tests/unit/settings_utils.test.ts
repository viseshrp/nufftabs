// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { getBatchSizeInput } from '../../entrypoints/options/settings_page';

describe('settings utils', () => {
  it('parses valid batch sizes', () => {
    const input = document.createElement('input');
    input.value = '12.7';
    expect(getBatchSizeInput(input)).toBe(12);
  });

  it('returns null for invalid batch sizes', () => {
    const input = document.createElement('input');
    input.value = '0';
    expect(getBatchSizeInput(input)).toBeNull();
    input.value = 'not-a-number';
    expect(getBatchSizeInput(input)).toBeNull();
  });
});
