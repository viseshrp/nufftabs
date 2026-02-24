import { describe, expect, it } from 'vitest';
import {
  NUFFTABS_BACKUP_FILE_PREFIX,
  createNufftabsBackupFileName,
  extractTabGroupCountFromBackupFileName,
  formatBackupTimestampSegment,
} from '../../entrypoints/shared/backup_filename';

describe('backup filename helpers', () => {
  it('formats timestamps as filename-safe ISO segments', () => {
    expect(formatBackupTimestampSegment(0)).toBe('1970-01-01T00-00-00-000Z');
  });

  it('creates canonical backup filenames with group counts', () => {
    const name = createNufftabsBackupFileName(Date.parse('2026-02-23T02:20:49.747Z'), 22);
    expect(name).toBe('nufftabs-backup-2026-02-23T02-20-49-747Z-g22.json');
    expect(name.startsWith(`${NUFFTABS_BACKUP_FILE_PREFIX}-`)).toBe(true);
    expect(extractTabGroupCountFromBackupFileName(name)).toBe(22);
  });

  it('returns 0 group count when missing or invalid', () => {
    expect(extractTabGroupCountFromBackupFileName('nufftabs-backup-2026-02-23T02-20-49-747Z.json')).toBe(0);
    expect(extractTabGroupCountFromBackupFileName('nufftabs-backup-2026-02-23T02-20-49-747Z-g0.json')).toBe(0);
    expect(extractTabGroupCountFromBackupFileName('nope.json')).toBe(0);
  });
});

