/*
 * Logging utilities mirrored from Wordspotting.
 */

type LogLevel = 'warn' | 'error';

export type ExtensionErrorOperation =
  | 'tab_query'
  | 'tab_message'
  | 'tab_reload'
  | 'script_injection'
  | 'badge_update'
  | 'notification'
  | 'runtime_context';

type LogExtensionErrorOptions = {
  level?: LogLevel;
  operation?: ExtensionErrorOperation;
};

const IGNORABLE_EXTENSION_ERROR_PATTERNS: Record<ExtensionErrorOperation, RegExp[]> = {
  tab_query: [
    /no tab with id/i,
    /the tab was closed/i,
    /tabs cannot be queried right now/i,
    /extension context invalidated/i,
  ],
  tab_message: [
    /receiving end does not exist/i,
    /listener indicated an asynchronous response/i,
    /message (port|channel) closed before a response was received/i,
    /no tab with id/i,
    /the tab was closed/i,
    /extension context invalidated/i,
  ],
  tab_reload: [
    /no tab with id/i,
    /the tab was closed/i,
    /extension context invalidated/i,
  ],
  script_injection: [
    /no tab with id/i,
    /the tab was closed/i,
    /cannot access contents of (the page|url)/i,
    /extension context invalidated/i,
  ],
  badge_update: [
    /no tab with id/i,
    /the tab was closed/i,
    /extension context invalidated/i,
  ],
  notification: [/extension context invalidated/i],
  runtime_context: [/extension context invalidated/i],
};

export function logit(message: string): void {
  if (import.meta.env.PROD) return;
  const dt = new Date();
  const utcDate = dt.toUTCString();
  console.log(`[${utcDate}]\t${message}`);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isIgnorableExtensionError(error: unknown, operation: ExtensionErrorOperation): boolean {
  const message = getErrorMessage(error);
  return IGNORABLE_EXTENSION_ERROR_PATTERNS[operation].some((pattern) => pattern.test(message));
}

export function logExtensionError(
  context: string,
  error: unknown,
  options: LogLevel | LogExtensionErrorOptions = 'warn',
): void {
  const resolved =
    typeof options === 'string'
      ? { level: options as LogLevel }
      : { level: options.level ?? 'warn', operation: options.operation };

  if (resolved.operation && isIgnorableExtensionError(error, resolved.operation)) return;
  if (resolved.level === 'warn' && import.meta.env.PROD) return;

  const logger = resolved.level === 'error' ? console.error : console.warn;
  const devLabel = import.meta.env.DEV && resolved.operation ? `[unexpected:${resolved.operation}] ` : '';
  logger(`${devLabel}${context}:`, error);
}

/**
 * Creates a debounced function that delays invoking `func` until after `wait` milliseconds
 * have elapsed since the last time the debounced function was invoked.
 *
 * @param func The function to debounce.
 * @param wait The number of milliseconds to delay.
 * @returns A new debounced function.
 */
export function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}
