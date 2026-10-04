#!/usr/bin/env node
// Merchant Brain: PhonePe Pulse importer.
//
// Reads the official PhonePe Pulse dataset (https://github.com/PhonePe/pulse)
// and upserts it into public.phonepe_pulse_metrics.
//
//   node scripts/import-phonepe-pulse.mjs --dry-run          # parse only, no DB
//   node scripts/import-phonepe-pulse.mjs --limit 50         # small test import
//   node scripts/import-phonepe-pulse.mjs                    # full import (remote)
//   node scripts/import-phonepe-pulse.mjs --target local     # local Supabase
//
// Design rules:
//   - Files are streamed one at a time; the dataset is never held in memory.
//   - Every row carries a deterministic source_key, so a rerun upserts instead
//     of duplicating: the script is idempotent and resumable by construction.
//   - All SQL is parameterised. No value from a JSON file reaches SQL as text.
//   - A malformed file or row is counted and skipped; it never aborts the run
//     and never writes a partial row.
//   - Secrets come from the environment only. Nothing is printed but the host.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const DEFAULT_ROOT = '/tmp/phonepe-pulse/data';
const TABLE = 'public.phonepe_pulse_metrics';

const CATEGORIES = new Set(['aggregated', 'map', 'top']);
const DATASETS = new Set(['transaction', 'user', 'merchant']);

// [data/]<category>/<dataset>[/hover]/country/india[/state/<slug>]/<year>/<quarter>.json
// The leading `data/` is optional: paths are normally relative to the dataset
// root, but accepting the repository-relative form keeps the parser reusable.
const SOURCE_PATH_RE =
  /^(?:data\/)?(aggregated|map|top)\/(transaction|user|merchant)\/(?:hover\/)?country\/india(?:\/state\/([^/]+))?\/(\d{4})\/([1-4])\.json$/;

// ---------------------------------------------------------------------------
// Path and name helpers (pure — these are the functions the unit tests pin)
// ---------------------------------------------------------------------------

/**
 * Parses a dataset-relative path into its dimensions.
 * Returns `{ ok: false, reason }` for anything that is not a known layout, so
 * an unexpected file is reported instead of silently mis-attributed.
 */
export function parseSourcePath(relativePath) {
  const match = SOURCE_PATH_RE.exec(relativePath);
  if (!match) return { ok: false, reason: 'unrecognised_path' };

  const [, category, dataset, stateSlug, yearText, quarterText] = match;
  if (!CATEGORIES.has(category) || !DATASETS.has(dataset)) {
    return { ok: false, reason: 'unrecognised_dimension' };
  }

  const scope = stateSlug ? 'state' : 'country';
  return {
    ok: true,
    category,
    dataset,
    scope,
    stateSlug: stateSlug ?? null,
    year: Number(yearText),
    quarter: Number(quarterText),
    scopeGeoName: scope === 'state' ? slugToName(stateSlug) : 'india',
  };
}

/** `andaman-&-nicobar-islands` → `andaman & nicobar islands`. */
export function slugToName(slug) {
  return normalizeName(String(slug).split('-').join(' '));
}

/** Lower-case, collapse whitespace, trim — the dataset's names are already
 *  lower-case but path slugs and JSON names must land on one canonical form. */
export function normalizeName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The deterministic identity of one observation.
 *
 * Includes the path scope so that a district ranked in the all-India file and
 * the same district in its state file are two different observations, and
 * excludes array position so a re-ordered upstream file cannot duplicate rows.
 */
export function buildSourceKey(meta, row) {
  return [
    meta.category,
    meta.dataset,
    meta.scope,
    `${meta.year}Q${meta.quarter}`,
    row.geoLevel,
    row.geoName,
    row.segment ?? '',
    row.metricType ?? '',
  ].join('|');
}

// ---------------------------------------------------------------------------
// Metric coercion — a bad number must never reach the database
// ---------------------------------------------------------------------------

// Parse-time drops (invalid metrics, repeated entities). Reset per file by
// parsePulseFile so the report can say how many candidate rows were discarded.
let droppedRows = 0;

function toCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value > Number.MAX_SAFE_INTEGER) return null;
  return Math.round(value);
}

function toAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value > Number.MAX_SAFE_INTEGER) return null;
  return value;
}

// ---------------------------------------------------------------------------
// Payload parsing — one function per dataset shape
// ---------------------------------------------------------------------------

function makeRow(meta, base) {
  return {
    datasetType: meta.dataset,
    category: meta.category,
    scope: meta.scope,
    year: meta.year,
    quarter: meta.quarter,
    geoLevel: base.geoLevel,
    geoName: base.geoName,
    parentGeoName: base.parentGeoName ?? null,
    segment: base.segment ?? null,
    metricType: base.metricType ?? null,
    rank: base.rank ?? null,
    transactionCount: base.transactionCount ?? null,
    transactionAmount: base.transactionAmount ?? null,
    registeredCount: base.registeredCount ?? null,
  };
}

/** aggregated/transaction: per-category instrument counts at the path scope. */
function parseAggregatedTransaction(meta, data) {
  const rows = [];
  const list = Array.isArray(data.transactionData) ? data.transactionData : [];
  for (const entry of list) {
    if (!entry || typeof entry.name !== 'string') {
      droppedRows += 1;
      continue;
    }
    const instruments = Array.isArray(entry.paymentInstruments) ? entry.paymentInstruments : [];
    for (const instrument of instruments) {
      if (!instrument || typeof instrument !== 'object') {
        droppedRows += 1;
        continue;
      }
      const count = toCount(instrument.count);
      if (count === null) {
        droppedRows += 1;
        continue;
      }
      rows.push(
        makeRow(meta, {
          geoLevel: meta.scope === 'state' ? 'state' : 'country',
          geoName: meta.scopeGeoName,
          parentGeoName: meta.scope === 'state' ? 'india' : null,
          segment: normalizeName(entry.name),
          metricType: typeof instrument.type === 'string' ? normalizeName(instrument.type) : null,
          transactionCount: count,
        }),
      );
    }
  }
  return rows;
}

/** aggregated/user and aggregated/merchant: one registered count at scope. */
function parseAggregatedRegistered(meta, data) {
  const aggregated = data.aggregated && typeof data.aggregated === 'object' ? data.aggregated : {};
  const count = toCount(aggregated.registeredCount);
  if (count === null) {
    droppedRows += 1;
    return [];
  }
  return [
    makeRow(meta, {
      geoLevel: meta.scope === 'state' ? 'state' : 'country',
      geoName: meta.scopeGeoName,
      parentGeoName: meta.scope === 'state' ? 'india' : null,
      registeredCount: count,
    }),
  ];
}

/** The geography the children of a map/top file belong to. */
function childGeo(meta, geoLevel) {
  return {
    geoLevel,
    parentGeoName: meta.scope === 'state' ? meta.scopeGeoName : geoLevel === 'state' ? 'india' : null,
  };
}

/** map/transaction: hoverDataList of { name, metric: [{type,count,amount}] }. */
function parseMapTransaction(meta, data) {
  const rows = [];
  const level = meta.scope === 'state' ? 'district' : 'state';
  const list = Array.isArray(data.hoverDataList) ? data.hoverDataList : [];
  for (const entry of list) {
    if (!entry || typeof entry.name !== 'string') {
      droppedRows += 1;
      continue;
    }
    const geo = childGeo(meta, level);
    const metrics = Array.isArray(entry.metric) ? entry.metric : [];
    for (const metric of metrics) {
      if (!metric || typeof metric !== 'object') {
        droppedRows += 1;
        continue;
      }
      const count = toCount(metric.count);
      const amount = toAmount(metric.amount);
      if (count === null && amount === null) {
        droppedRows += 1;
        continue;
      }
      rows.push(
        makeRow(meta, {
          ...geo,
          geoName: normalizeName(entry.name),
          metricType: typeof metric.type === 'string' ? normalizeName(metric.type) : null,
          transactionCount: count,
          transactionAmount: amount,
        }),
      );
    }
  }
  return rows;
}

/** map/user and map/merchant: hoverData { name: { registeredCount } }. */
function parseMapRegistered(meta, data) {
  const rows = [];
  const level = meta.scope === 'state' ? 'district' : 'state';
  const hover = data.hoverData && typeof data.hoverData === 'object' ? data.hoverData : {};
  for (const [name, value] of Object.entries(hover)) {
    const count = toCount(value && typeof value === 'object' ? value.registeredCount : null);
    if (count === null) {
      droppedRows += 1;
      continue;
    }
    rows.push(
      makeRow(meta, { ...childGeo(meta, level), geoName: normalizeName(name), registeredCount: count }),
    );
  }
  return rows;
}

function parseTopList(meta, list, geoLevel, toRow) {
  const rows = [];
  if (!Array.isArray(list)) return rows;
  let rank = 1;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      droppedRows += 1;
      continue;
    }
    const name = typeof entry.name === 'string' ? entry.name : entry.entityName;
    if (typeof name !== 'string') {
      droppedRows += 1;
      continue;
    }
    const row = toRow(entry, rank);
    if (!row) {
      droppedRows += 1;
      continue;
    }
    rows.push(
      makeRow(meta, {
        ...childGeo(meta, geoLevel),
        ...row,
        geoName: normalizeName(name),
        rank,
      }),
    );
    rank += 1;
  }
  return rows;
}

/** top/transaction: ranked states and districts with counts. */
function parseTopTransaction(meta, data) {
  const toRow = (entry, rank) => {
    const metric = entry.metric && typeof entry.metric === 'object' ? entry.metric : {};
    const count = toCount(metric.count);
    if (count === null) return null;
    return {
      metricType: typeof metric.type === 'string' ? normalizeName(metric.type) : null,
      transactionCount: count,
      rank,
    };
  };
  const states = parseTopList(meta, data.states, 'state', toRow);
  const districts = parseTopList(meta, data.districts, 'district', toRow);
  return { states, districts };
}

/** top/user and top/merchant: ranked states and districts with counts. */
function parseTopRegistered(meta, data) {
  const toRow = (entry) => {
    const count = toCount(entry.registeredCount);
    if (count === null) return null;
    return { registeredCount: count };
  };
  const states = parseTopList(meta, data.states, 'state', toRow);
  const districts = parseTopList(meta, data.districts, 'district', toRow);
  return { states, districts };
}

/**
 * Turns one parsed file into rows.
 * Returns `{ rows, warnings }` — warnings name data the file contained that
 * this importer does not model, so gaps show up in the log instead of hiding.
 */
export function parsePulseFile(relativePath, payload) {
  droppedRows = 0;
  const meta = parseSourcePath(relativePath);
  if (!meta.ok) return { rows: [], warnings: [meta.reason], dropped: 0 };

  const data =
    payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
      ? payload.data
      : null;
  if (!data) return { rows: [], warnings: ['missing_data_object'], dropped: 0 };

  const warnings = [];
  let rows = [];

  if (meta.category === 'aggregated') {
    rows =
      meta.dataset === 'transaction'
        ? parseAggregatedTransaction(meta, data)
        : parseAggregatedRegistered(meta, data);
    assertOnlyKeys(data, ['transactionData', 'aggregated'], warnings);
  } else if (meta.category === 'map') {
    rows = meta.dataset === 'transaction' ? parseMapTransaction(meta, data) : parseMapRegistered(meta, data);
    assertOnlyKeys(data, ['hoverDataList', 'hoverData'], warnings);
  } else {
    const parsed =
      meta.dataset === 'transaction' ? parseTopTransaction(meta, data) : parseTopRegistered(meta, data);
    rows = [...parsed.states, ...parsed.districts];
    assertOnlyKeys(data, ['states', 'districts', 'pincodes'], warnings);
  }

  // One observation per identity. A duplicate within a file means the source
  // repeated an entity: keep the first, count the rest as skipped.
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const key = buildSourceKey(meta, row);
    if (seen.has(key)) {
      warnings.push(`duplicate_source_key:${key}`);
      droppedRows += 1;
      continue;
    }
    seen.add(key);
    unique.push({ ...row, sourceKey: key, sourceFile: relativePath });
  }

  return { rows: unique, warnings, dropped: droppedRows };
}

function assertOnlyKeys(data, allowed, warnings) {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) warnings.push(`unmodelled_section:${key}`);
  }
}

// ---------------------------------------------------------------------------
// Database write
// ---------------------------------------------------------------------------

const COLUMNS = [
  'source_key',
  'dataset_type',
  'category',
  'scope',
  'year',
  'quarter',
  'geo_level',
  'geo_name',
  'parent_geo_name',
  'segment',
  'metric_type',
  'rank',
  'transaction_count',
  'transaction_amount',
  'registered_count',
  'source_file',
];

function buildUpsertSql(batchSize) {
  const tuples = [];
  let cursor = 1;
  for (let i = 0; i < batchSize; i += 1) {
    const placeholders = [];
    for (let c = 0; c < COLUMNS.length; c += 1) {
      placeholders.push(`$${cursor}`);
      cursor += 1;
    }
    tuples.push(`(${placeholders.join(', ')})`);
  }
  return `INSERT INTO ${TABLE} (${COLUMNS.join(', ')})\nVALUES ${tuples.join(',\n')}\n` +
    'ON CONFLICT (source_key) DO UPDATE SET\n' +
    '  transaction_count = EXCLUDED.transaction_count,\n' +
    '  transaction_amount = EXCLUDED.transaction_amount,\n' +
    '  registered_count = EXCLUDED.registered_count,\n' +
    '  rank = EXCLUDED.rank,\n' +
    '  parent_geo_name = EXCLUDED.parent_geo_name,\n' +
    '  source_file = EXCLUDED.source_file,\n' +
    '  ingested_at = now()\n' +
    'RETURNING (xmax = 0) AS inserted';
}

function rowParams(row) {
  return [
    row.sourceKey,
    row.datasetType,
    row.category,
    row.scope,
    row.year,
    row.quarter,
    row.geoLevel,
    row.geoName,
    row.parentGeoName,
    row.segment,
    row.metricType,
    row.rank,
    row.transactionCount,
    row.transactionAmount,
    row.registeredCount,
    row.sourceFile,
  ];
}

/** Upserts a batch. On failure it falls back to single rows so one bad row
 *  cannot discard 499 good ones, and reports which row was rejected. */
async function writeBatch(client, batch, stats, log) {
  if (batch.length === 0) return;
  try {
    const params = batch.flatMap(rowParams);
    const result = await client.query(buildUpsertSql(batch.length), params);
    for (const row of result.rows) {
      if (row.inserted) stats.rowsInserted += 1;
      else stats.rowsUpdated += 1;
    }
  } catch (error) {
    if (batch.length === 1) {
      stats.rowsRejected += 1;
      stats.rejections.push(`${batch[0].sourceKey}: ${error.message}`);
      return;
    }
    log(`  batch of ${batch.length} failed, retrying row by row: ${error.message}`);
    for (const row of batch) await writeBatch(client, [row], stats, log);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function loadEnvFile(name) {
  try {
    process.loadEnvFile(join(REPO_ROOT, name));
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const options = {
    root: process.env.PHONEPE_PULSE_DIR ?? DEFAULT_ROOT,
    dryRun: false,
    limit: null,
    batch: 500,
    target: 'remote',
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--local') options.target = 'local';
    else if (arg === '--root') options.root = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--batch') options.batch = Math.max(1, Number(argv[++i]) || 500);
    else if (arg === '--target') options.target = argv[++i] === 'local' ? 'local' : 'remote';
    else {
      console.error(`Unknown argument: ${arg}`);
      console.error('Usage: node scripts/import-phonepe-pulse.mjs [--root <dir>] [--dry-run] ' +
        '[--limit <n>] [--batch <n>] [--target remote|local] [--quiet]');
      process.exit(2);
    }
  }
  if (!['remote', 'local'].includes(options.target)) options.target = 'remote';
  if (!Number.isFinite(options.batch)) options.batch = 500;
  if (options.limit !== null && (!Number.isFinite(options.limit) || options.limit < 1)) options.limit = null;
  return options;
}

async function discoverFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath ?? entry.path ?? root, entry.name));
}

function emptyStats() {
  return {
    filesProcessed: 0,
    filesFailed: 0,
    filesSkipped: 0,
    rowsParsed: 0,
    rowsDropped: 0,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsRejected: 0,
    warnings: 0,
    byDataset: { transaction: 0, user: 0, merchant: 0 },
    rejections: [],
  };
}

export async function importPulseData(options) {
  const startedAt = Date.now();
  const stats = emptyStats();
  const log = options.quiet ? () => {} : (message) => console.log(message);
  const root = String(options.root).replace(/\/+$/, '');

  const files = await discoverFiles(root);
  const total = options.limit ? Math.min(options.limit, files.length) : files.length;
  log('PhonePe Pulse import');
  log(`  root:  ${root}`);
  log(`  files: ${total}${options.limit ? ` (limited from ${files.length})` : ''}`);

  let client = null;
  let pool = null;
  if (!options.dryRun) {
    // Remote (linked Supabase) is the default target. `.env.local` is loaded
    // only for --target local, because process.loadEnvFile never overrides an
    // already-set DATABASE_URL and .env.local points at the local stack.
    if (options.target === 'local') loadEnvFile('.env.local');
    loadEnvFile('.env');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required. Set it in .env (remote) or .env.local (local).');
    }
    if (connectionString.includes('[YOUR_PASSWORD]')) {
      throw new Error('DATABASE_URL still contains the [YOUR_PASSWORD] placeholder.');
    }
    pool = new pg.Pool({ connectionString, max: 2 });
    client = await pool.connect();
    const { rows } = await client.query('SELECT current_database() AS db, inet_server_addr() AS host');
    log(`  db:    ${rows[0].db} @ ${rows[0].host ?? 'unknown'}`);
  }

  let pending = [];
  const flush = async () => {
    if (pending.length === 0) return;
    if (!client) {
      pending = [];
      return;
    }
    const batch = pending;
    pending = [];
    await writeBatch(client, batch, stats, log);
  };

  try {
    for (let i = 0; i < total; i += 1) {
      const absolute = files[i];
      const relative = absolute.startsWith(`${root}/`)
        ? absolute.slice(root.length + 1)
        : absolute;

      let payload;
      try {
        payload = JSON.parse(await readFile(absolute, 'utf8'));
      } catch (error) {
        stats.filesFailed += 1;
        log(`  FAILED ${relative}: ${error.message}`);
        continue;
      }

      const parsed = parsePulseFile(relative, payload);
      if (parsed.rows.length > 0) stats.filesProcessed += 1;
      else stats.filesSkipped += 1;
      stats.warnings += parsed.warnings.length;
      stats.rowsParsed += parsed.rows.length;
      stats.rowsDropped += parsed.dropped ?? 0;

      for (const row of parsed.rows) {
        stats.byDataset[row.datasetType] += 1;
        pending.push(row);
        if (pending.length >= options.batch) await flush();
      }

      if ((i + 1) % 1000 === 0) {
        log(
          `  ${i + 1}/${total} files | rows parsed ${stats.rowsParsed} | ` +
            `inserted ${stats.rowsInserted} | updated ${stats.rowsUpdated}`,
        );
      }
    }
    await flush();
  } finally {
    if (client) client.release();
    if (pool) await pool.end();
  }

  stats.runtimeMs = Date.now() - startedAt;
  stats.totalFiles = files.length;
  stats.filesExamined = total;
  stats.dryRun = Boolean(options.dryRun);
  return stats;
}

function formatReport(stats) {
  const seconds = (stats.runtimeMs / 1000).toFixed(1);
  const lines = [
    '',
    'PhonePe Pulse import complete',
    `  files processed   : ${stats.filesProcessed}`,
    `  files failed      : ${stats.filesFailed}`,
    `  files skipped     : ${stats.filesSkipped}`,
    `  files examined    : ${stats.filesExamined}`,
    `  rows parsed       : ${stats.rowsParsed}`,
    `  rows inserted     : ${stats.rowsInserted}`,
    `  rows updated      : ${stats.rowsUpdated}`,
    `  rows skipped      : ${stats.rowsDropped + stats.rowsRejected}`,
    `  rows rejected     : ${stats.rowsRejected}`,
    `  transaction rows  : ${stats.byDataset.transaction}`,
    `  user rows         : ${stats.byDataset.user}`,
    `  merchant rows     : ${stats.byDataset.merchant}`,
    `  warnings          : ${stats.warnings}`,
    `  runtime           : ${seconds}s${stats.dryRun ? ' (dry run — nothing written)' : ''}`,
  ];
  if (stats.rejections.length > 0) {
    lines.push('  rejected rows:');
    for (const entry of stats.rejections.slice(0, 10)) lines.push(`    - ${entry}`);
  }
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const stats = await importPulseData(options);
  console.log(formatReport(stats));
  if (stats.filesFailed > 0 || stats.rowsRejected > 0) process.exitCode = 1;
}

if (pathToFileURL(process.argv[1] ?? '').href === import.meta.url) {
  main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}
