#!/usr/bin/env node
// Merchant Brain: Database Seed Runner
//
// Applies the development seed data from supabase/seed.sql.
// This is for local development and testing only.
//
// Usage:
//   npm run db:seed

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_FILE = join(__dirname, '..', 'supabase', 'seed.sql');

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(join(__dirname, '..', envFile));
    break;
  } catch {
    // proceed if file not present
  }
}

async function main() {
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
    const sql = await readFile(SEED_FILE, 'utf-8');
    const client = await pool.connect();

    try {
      console.log('Applying seed data...');
      await client.query(sql);
      console.log('Seed data applied successfully.');
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
