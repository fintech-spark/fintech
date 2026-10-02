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
import { fileURLToPath } from 'node:url';
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

async function runMigrations(pool) {
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);
    const appliedSet = new Set(applied.map((r) => r.filename));

    const pending = (await getPendingMigrations()).filter(
      (m) => !appliedSet.has(m.filename)
    );

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
    const applied = await getAppliedMigrations(client);
    const appliedSet = new Set(applied.map((r) => r.filename));
    const allMigrations = await getPendingMigrations();

    console.log('\nMigration Status:');
    console.log('─'.repeat(70));

    for (const migration of allMigrations) {
      const isApplied = appliedSet.has(migration.filename);
      const status = isApplied ? '✓ applied' : '○ pending';
      console.log(`  ${status}  ${migration.filename}`);
    }

    const pendingCount = allMigrations.filter((m) => !appliedSet.has(m.filename)).length;
    console.log('─'.repeat(70));
    console.log(`  ${applied.length} applied, ${pendingCount} pending\n`);
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
