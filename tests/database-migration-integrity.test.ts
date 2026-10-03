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
import { describe, expect, it } from 'vitest';
import { findDrift } from '../scripts/migrate.mjs';

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
