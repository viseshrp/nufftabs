/**
 * Logging and error-handling utilities for the nufftabs extension.
 * Provides structured error logging with per-operation suppression of
 * expected Chrome API errors (e.g. "no tab with id" after a tab closes).
 */

/** Severity level used when emitting console log messages. */
type LogLevel = 'warn' | 'error';

/** Chrome API operation categories; each maps to a set of ignorable error patterns. */
export type ExtensionErrorOperation =
  | 'tab_query'
  | 'tab_message'
  | 'tab_reload'
  | 'script_injection'
  | 'badge_update'
  | 'notification'
  | 'runtime_context';

/** Options accepted by `logExtensionError` for controlling log level and suppression. */
type LogExtensionErrorOptions = {
  level?: LogLevel;
  operation?: ExtensionErrorOperation;
};

/**
 * Regex patterns for Chrome API errors that are safe to suppress per operation.
 * Matching errors are swallowed instead of being logged to the console.
 */
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

/** Logs a timestamped debug message in development builds only. */
export function logit(message: string): void {
  if (import.meta.env.PROD) return;
  const dt = new Date();
  const utcDate = dt.toUTCString();
  console.log(`[${utcDate}]\t${message}`);
}

/** Extracts a human-readable message from an unknown error value. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Runs async work over a list with bounded parallelism.
 * Uses a small worker pool to cap in-flight tasks while preserving throughput.
 */
export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const current = items[nextIndex];
      nextIndex += 1;
      if (current !== undefined) await task(current);
    }
  });
  await Promise.all(workers);
}

/** Returns true if the error matches a known-ignorable pattern for the given operation. */
export function isIgnorableExtensionError(error: unknown, operation: ExtensionErrorOperation): boolean {
  const message = getErrorMessage(error);
  return IGNORABLE_EXTENSION_ERROR_PATTERNS[operation].some((pattern) => pattern.test(message));
}

/**
 * Logs an extension error unless it matches a known-ignorable pattern.
 * In production, only 'error'-level messages are emitted; warnings are suppressed.
 */
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
