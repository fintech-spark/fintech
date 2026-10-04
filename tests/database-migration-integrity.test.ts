// Merchant Brain: migration history integrity.
//
// scripts/migrate.mjs refuses to run when a migration that was already applied
// no longer matches the file on disk — the database and the repository would
// otherwise disagree about schema history, and the next environment to run the
// edited file would diverge from this one. These tests pin that rule, including
// the one escape hatch the real database uses: rows stamped `manual-cloud-apply`
// were applied outside the runner and have no digest, so they warn instead of
// blocking (three migrations in this project are such rows).

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { findDrift, syncFromSupabaseMigrations } from '../scripts/migrate.mjs';

function file(name: string, contents: string) {
  return {
    filename: name,
    content: contents,
    checksum: createHash('sha256').update(contents).digest('hex'),
  };
}

const NAME = '20261002000000_core_tables.sql';

describe('findDrift', () => {
  it('passes when the applied digest matches the file byte for byte', () => {
    const onDisk = [file(NAME, 'CREATE TABLE businesses ();')];
    const applied = [{ filename: NAME, checksum: onDisk[0].checksum }];

    expect(findDrift(applied, onDisk)).toEqual([]);
  });

  it('blocks when an applied migration file was edited afterwards', () => {
    const onDisk = [file(NAME, 'CREATE TABLE businesses (id uuid);')];
    const applied = [
      { filename: NAME, checksum: createHash('sha256').update('CREATE TABLE businesses ();').digest('hex') },
    ];

    const drift = findDrift(applied, onDisk);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ problem: 'modified', blocking: true });
  });

  it('blocks when a recorded migration file disappeared', () => {
    const drift = findDrift([{ filename: NAME, checksum: createHash('sha256').update('x').digest('hex') }], []);

    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ problem: 'missing', blocking: true });
  });

  it('warns without blocking on rows stamped outside the runner', () => {
    const onDisk = [file(NAME, 'CREATE TABLE businesses ();')];
    const applied = [{ filename: NAME, checksum: 'manual-cloud-apply' }];

    const drift = findDrift(applied, onDisk);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ problem: 'unverified', blocking: false });
  });

  it('does not confuse a pending migration with a drifted one', () => {
    const applied = [file('20261002000000_init_extensions.sql', 'CREATE EXTENSION pgcrypto;')];
    const onDisk = [...applied, file('20261002000001_core_tables.sql', 'CREATE TABLE businesses ();')];

    expect(findDrift(applied, onDisk)).toEqual([]);
  });
});

describe('syncFromSupabaseMigrations', () => {
  it('synchronizes migrations when supabase_migrations.schema_migrations exists', async () => {
    const inserted: [string, string][] = [];
    const mockClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: [{ '1': 1 }], rowCount: 1 };
        }
        if (sql.includes('supabase_migrations.schema_migrations')) {
          return { rows: [{ version: '20261002000001' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO _migrations')) {
          inserted.push([params![0] as string, params![1] as string]);
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const onDisk = [
      file('20261002000001_core_tables.sql', 'CREATE TABLE businesses ();'),
      file('20261002000002_indexes.sql', 'CREATE INDEX idx_1;'),
    ];

    const synced = await syncFromSupabaseMigrations(mockClient, onDisk);
    expect(synced).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0][0]).toBe('20261002000001_core_tables.sql');
    expect(inserted[0][1]).toBe(onDisk[0].checksum);
  });

  it('returns 0 safely when supabase_migrations table is absent', async () => {
    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('information_schema.tables')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const onDisk = [file('20261002000001_core_tables.sql', 'CREATE TABLE businesses ();')];
    const synced = await syncFromSupabaseMigrations(mockClient, onDisk);
    expect(synced).toBe(0);
  });
});
