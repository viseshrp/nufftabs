// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { debounce } from '../../entrypoints/shared/utils';

describe('debounce', () => {
  it('should debounce function calls', async () => {
    vi.useFakeTimers();
    const func = vi.fn();
    const debounced = debounce(func, 100);

    debounced();
    debounced();
    debounced();

    expect(func).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(func).toHaveBeenCalledTimes(1);
  });

  it('should execute the debounced function with the latest arguments', async () => {
    vi.useFakeTimers();
    const func = vi.fn();
    const debounced = debounce(func, 100);

    debounced(1);
    debounced(2);
    debounced(3);

    vi.advanceTimersByTime(100);

    expect(func).toHaveBeenCalledWith(3);
  });
});
