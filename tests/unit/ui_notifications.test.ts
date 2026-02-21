// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createInlineNotifier, createSnackbarNotifier } from '../../entrypoints/ui/notifications';

describe('ui notifications', () => {
  it('safely no-ops when inline notifier has no element', () => {
    const notifier = createInlineNotifier(null);
    expect(() => notifier.notify('ignored')).not.toThrow();
    expect(() => notifier.clear()).not.toThrow();
  });

  it('writes and clears inline status messages', () => {
    const statusEl = document.createElement('div');
    const notifier = createInlineNotifier(statusEl);

    notifier.notify('Saved.');
    expect(statusEl.textContent).toBe('Saved.');

    notifier.clear();
    expect(statusEl.textContent).toBe('');
  });

  it('shows snackbar text and hides it after the configured duration', () => {
    vi.useFakeTimers();

    const snackbarEl = document.createElement('div');
    const notifier = createSnackbarNotifier(snackbarEl, { durationMs: 50 });

    notifier.notify('Done.');
    expect(snackbarEl.textContent).toBe('Done.');
    expect(snackbarEl.classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(49);
    expect(snackbarEl.classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(1);
    expect(snackbarEl.classList.contains('show')).toBe(false);

    vi.useRealTimers();
  });

  it('restarts snackbar timer when a new message arrives', () => {
    vi.useFakeTimers();

    const snackbarEl = document.createElement('div');
    const notifier = createSnackbarNotifier(snackbarEl, { durationMs: 100 });

    notifier.notify('First');
    vi.advanceTimersByTime(60);
    notifier.notify('Second');
    expect(snackbarEl.textContent).toBe('Second');
    expect(snackbarEl.classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(60);
    expect(snackbarEl.classList.contains('show')).toBe(true);

    vi.advanceTimersByTime(40);
    expect(snackbarEl.classList.contains('show')).toBe(false);

    vi.useRealTimers();
  });

  it('clears snackbar immediately and supports missing elements', () => {
    vi.useFakeTimers();

    const snackbarEl = document.createElement('div');
    const notifier = createSnackbarNotifier(snackbarEl, { durationMs: 1000 });

    notifier.notify('Will clear');
    notifier.clear();
    expect(snackbarEl.classList.contains('show')).toBe(false);
    expect(snackbarEl.textContent).toBe('');

    const nullNotifier = createSnackbarNotifier(null);
    expect(() => nullNotifier.notify('ignored')).not.toThrow();
    expect(() => nullNotifier.clear()).not.toThrow();

    vi.useRealTimers();
  });
});
