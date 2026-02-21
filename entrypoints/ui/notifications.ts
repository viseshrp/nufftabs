/**
 * UI notification helpers shared by user-facing pages.
 *
 * The module intentionally provides small, DOM-only adapters so each page can:
 * - keep its existing markup/CSS contract,
 * - centralize how user-facing messages are written,
 * - avoid duplicating timer/clear behavior in page-specific files.
 */

/** Common notification contract used by UI pages to surface messages to users. */
export type UiNotifier = {
  /** Displays the given user-facing message. */
  notify: (message: string) => void;
  /** Clears any currently displayed message and pending timers. */
  clear: () => void;
};

/** Optional runtime behavior for snackbar notifications. */
export type SnackbarNotifierOptions = {
  /**
   * Visibility duration in milliseconds.
   * Defaults to the existing UI timing so behavior stays backward compatible.
   */
  durationMs?: number;
};

/**
 * Creates a notifier for plain status regions that only render text content.
 *
 * This adapter is intentionally minimal: it updates text and does not mutate
 * classes or attributes, matching the existing options/auth page behavior.
 */
export function createInlineNotifier(statusEl: HTMLDivElement | null): UiNotifier {
  return {
    notify(message: string): void {
      if (!statusEl) return;
      statusEl.textContent = message;
    },
    clear(): void {
      if (!statusEl) return;
      statusEl.textContent = '';
    },
  };
}

/**
 * Creates a notifier for snackbar-style status regions.
 *
 * It toggles the existing `.show` class and maintains a single timer so rapid
 * updates replace one another predictably without stacked timers.
 */
export function createSnackbarNotifier(
  snackbarEl: HTMLDivElement | null,
  options: SnackbarNotifierOptions = {},
): UiNotifier {
  let hideTimer: number | undefined;
  const durationMs = options.durationMs ?? 2200;

  const clearTimer = () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };

  return {
    notify(message: string): void {
      if (!snackbarEl) return;
      snackbarEl.textContent = message;
      snackbarEl.classList.add('show');
      clearTimer();
      hideTimer = window.setTimeout(() => {
        snackbarEl.classList.remove('show');
        hideTimer = undefined;
      }, durationMs);
    },
    clear(): void {
      clearTimer();
      if (!snackbarEl) return;
      snackbarEl.classList.remove('show');
      snackbarEl.textContent = '';
    },
  };
}
