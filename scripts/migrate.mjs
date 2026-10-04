#!/usr/bin/env node
// Merchant Brain: Database Migration Runner
//
// Applies pending SQL migrations from supabase/migrations/ in filename order.
// Tracks applied migrations in the _migrations table with checksums.
//
// Usage:
//   npm run db:migrate              # Apply all pending migrations
//   npm run db:migrate:status       # Show migration status
//   node scripts/migrate.mjs        # Direct invocation
//   node scripts/migrate.mjs status # Status check
//
// Requires DATABASE_URL environment variable.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(join(__dirname, '..', envFile));
    break;
  } catch {
    // proceed if file not present
  }
}

async function main() {
  const command = process.argv[2] ?? 'up';
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('Error: DATABASE_URL environment variable is required.');
    console.error('Set it in .env or export DATABASE_URL=postgresql://...');
    process.exit(1);
  }

  if (connectionString.includes('[YOUR_PASSWORD]')) {
    console.error('Error: DATABASE_URL contains placeholder "[YOUR_PASSWORD]".');
    console.error('Please open .env and replace [YOUR_PASSWORD] with your actual Supabase database password.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });

  try {
    if (command === 'status') {
      await showStatus(pool);
    } else if (command === 'up' || command === undefined) {
      await runMigrations(pool);
    } else {
      console.error(`Unknown command: ${command}`);
      console.error('Usage: npm run db:migrate [up|status]');
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          serial PRIMARY KEY,
      filename    text    NOT NULL,
      checksum    text    NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_migrations_filename ON _migrations (filename);
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query(
    'SELECT filename, checksum FROM _migrations ORDER BY filename ASC'
  );
  return result.rows;
}

/**
 * Reconciles applied migrations from Supabase CLI's internal tracking table
 * (supabase_migrations.schema_migrations) when migrations were applied by
 * `supabase start` or `supabase db reset`. Prevents duplicate application.
 */
async function syncFromSupabaseMigrations(client, allMigrations) {
  try {
    const tableCheck = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
    `);
    if (!tableCheck.rows || tableCheck.rows.length === 0) {
      return 0;
    }

    const { rows: supabaseRows } = await client.query(
      'SELECT version FROM supabase_migrations.schema_migrations'
    );
    if (!supabaseRows || supabaseRows.length === 0) {
      return 0;
    }

    const appliedVersions = new Set(supabaseRows.map((r) => String(r.version)));
    let synced = 0;

    for (const migration of allMigrations) {
      const version = migration.filename.split('_')[0];
      const matches =
        appliedVersions.has(version) ||
        appliedVersions.has(migration.filename) ||
        appliedVersions.has(migration.filename.replace(/\.sql$/, ''));

      if (matches) {
        const result = await client.query(
          `INSERT INTO _migrations (filename, checksum)
           VALUES ($1, $2)
           ON CONFLICT (filename) DO NOTHING`,
          [migration.filename, migration.checksum]
        );
        if ((result.rowCount ?? 0) > 0) {
          synced++;
        }
      }
    }

    if (synced > 0) {
      console.log(`Synced ${synced} migration(s) from supabase_migrations history.`);
    }
    return synced;
  } catch {
    return 0;
  }
}

async function getPendingMigrations() {
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

  return Promise.all(
    sqlFiles.map(async (filename) => {
      const content = await readFile(join(MIGRATIONS_DIR, filename), 'utf-8');
      const checksum = createHash('sha256').update(content).digest('hex');
      return { filename, content, checksum };
    })
  );
}

// An applied migration is a historical fact: its file must be byte-identical to
// what ran. If someone edits one after the fact, the database and the repository
// silently disagree about schema history, and the next environment that runs the
// edited file diverges from this one. Detect it before applying anything new.
//
// A recorded checksum that is not a sha256 digest (e.g. rows stamped by hand or
// applied outside this runner) has no reference to compare against: report it as
// unverified rather than as a mismatch, because there is nothing to prove wrong.
const SHA256_HEX = /^[0-9a-f]{64}$/;

function findDrift(applied, onDisk) {
  const byName = new Map(onDisk.map((m) => [m.filename, m]));
  const drift = [];

  for (const row of applied) {
    const file = byName.get(row.filename);
    if (!file) {
      drift.push({
        filename: row.filename,
        problem: 'missing',
        blocking: true,
        message: `recorded in the database, absent from supabase/migrations/`,
      });
      continue;
    }
    if (!SHA256_HEX.test(row.checksum)) {
      drift.push({
        filename: row.filename,
        problem: 'unverified',
        blocking: false,
        message: `applied as "${row.checksum}" — no digest to compare (applied outside this runner?)`,
      });
      continue;
    }
    if (file.checksum !== row.checksum) {
      drift.push({
        filename: row.filename,
        problem: 'modified',
        blocking: true,
        message: `applied digest ${row.checksum.slice(0, 12)} ≠ file digest ${file.checksum.slice(0, 12)}`,
      });
    }
  }

  return drift;
}

function reportDrift(drift) {
  const blocking = drift.filter((d) => d.blocking);
  const unverified = drift.filter((d) => !d.blocking);

  if (blocking.length > 0) {
    console.error('\nMigration drift detected — refusing to run.');
    for (const entry of blocking) {
      const detail = entry.problem === 'modified' ? 'EDITED' : 'MISSING';
      console.error(`  [${detail}] ${entry.filename}`);
      console.error(`          ${entry.message}`);
    }
    if (blocking.some((d) => d.problem === 'modified')) {
      console.error(
        '\nAn already-applied migration must never be edited. Restore it:\n' +
          '  git checkout -- supabase/migrations/<file>\n' +
          'and express the change as a NEW migration file.',
      );
    }
    if (blocking.some((d) => d.problem === 'missing')) {
      console.error(
        '\nA recorded migration file was deleted. Restore it from git so the\n' +
          'schema history stays reproducible, or document the history rewrite.',
      );
    }
  }

  for (const entry of unverified) {
    console.warn(`  [UNVERIFIED] ${entry.filename}: ${entry.message}`);
  }
  if (unverified.length > 0) {
    console.warn(
      '  These rows cannot be integrity-checked. They do not block the run;\n' +
        '  future migrations are hashed automatically when applied here.',
    );
  }
}

async function runMigrations(pool) {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const allMigrations = await getPendingMigrations();
    await syncFromSupabaseMigrations(client, allMigrations);
    const applied = await getAppliedMigrations(client);
    const appliedSet = new Set(applied.map((r) => r.filename));

    const drift = findDrift(applied, allMigrations);
    reportDrift(drift);
    if (drift.some((entry) => entry.blocking)) {
      process.exitCode = 1;
      return;
    }

    const pending = allMigrations.filter((m) => !appliedSet.has(m.filename));

    if (pending.length === 0) {
      console.log('All migrations are already applied.');
      return;
    }

    console.log(`Found ${pending.length} pending migration(s).`);

    for (const migration of pending) {
      console.log(`  Applying: ${migration.filename}`);

      try {
        await client.query('BEGIN');
        await client.query(migration.content);
        await client.query(
          'INSERT INTO _migrations (filename, checksum) VALUES ($1, $2)',
          [migration.filename, migration.checksum]
        );
        await client.query('COMMIT');
        console.log(`    OK: ${migration.filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`    FAILED: ${migration.filename}`);
        console.error(`    Error: ${error.message}`);
        process.exit(1);
      }
    }

    console.log(`\n${pending.length} migration(s) applied successfully.`);
  } finally {
    client.release();
  }
}

async function showStatus(pool) {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const allMigrations = await getPendingMigrations();
    await syncFromSupabaseMigrations(client, allMigrations);
    const applied = await getAppliedMigrations(client);
    const appliedSet = new Set(applied.map((r) => r.filename));
    const drift = findDrift(applied, allMigrations);
    const driftByName = new Map(drift.map((d) => [d.filename, d]));

    console.log('\nMigration Status:');
    console.log('─'.repeat(70));

    for (const migration of allMigrations) {
      const driftEntry = driftByName.get(migration.filename);
      const status = driftEntry
        ? { modified: '✗ edited', missing: '✗ gone', unverified: '? nohash' }[driftEntry.problem]
        : appliedSet.has(migration.filename)
          ? '✓ applied'
          : '○ pending';
      console.log(`  ${status.padEnd(9)} ${migration.filename}`);
    }

    const pendingCount = allMigrations.filter((m) => !appliedSet.has(m.filename)).length;
    const blockingCount = drift.filter((d) => d.blocking).length;
    const unverifiedCount = drift.length - blockingCount;
    console.log('─'.repeat(70));
    console.log(
      `  ${applied.length} applied, ${pendingCount} pending` +
        (blockingCount > 0 ? `, ${blockingCount} drifted` : '') +
        (unverifiedCount > 0 ? `, ${unverifiedCount} unverified` : '') +
        '\n',
    );
    reportDrift(drift);
    if (blockingCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    client.release();
  }
}

// Run the CLI only when executed directly, so tests can import the integrity
// rules without opening a database connection.
export { findDrift, syncFromSupabaseMigrations };

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}
