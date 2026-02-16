import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getErrorMessage,
  isIgnorableExtensionError,
  logExtensionError,
  logit,
} from '../../entrypoints/shared/utils';

describe('logging utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('returns a usable string for unknown errors', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage('boom')).toBe('boom');
    expect(getErrorMessage(42)).toBe('42');
  });

  it('detects ignorable extension errors by operation', () => {
    expect(isIgnorableExtensionError(new Error('No tab with id: 42'), 'tab_query')).toBe(true);
    expect(isIgnorableExtensionError(new Error('Unexpected failure'), 'tab_query')).toBe(false);
  });

  it('logs debug messages outside production', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logit('hello');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('hello');
  });

  it('suppresses debug messages in production', () => {
    vi.stubEnv('PROD', true);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logit('hello');
    expect(spy).not.toHaveBeenCalled();
  });

  it('suppresses ignorable warn logs for known transient tab errors', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logExtensionError('context', new Error('The tab was closed.'), { operation: 'tab_query' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs warn messages for unexpected operation errors', () => {
    vi.stubEnv('DEV', true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logExtensionError('context', new Error('boom'), { operation: 'tab_query' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('[unexpected:tab_query] context:');
  });

  it('suppresses warn logs in production mode', () => {
    vi.stubEnv('PROD', true);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logExtensionError('context', new Error('boom'), { level: 'warn', operation: 'tab_query' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('always logs explicit error-level entries', () => {
    vi.stubEnv('PROD', true);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logExtensionError('context', new Error('boom'), 'error');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('context:');
  });
});
