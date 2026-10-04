#!/usr/bin/env node
// Merchant Brain: tenant-safety scanner.
//
// WHY THIS EXISTS
// ---------------
// Two database paths exist. The PostgREST path is protected by RLS. The raw `pg`
// path (`wireIntelligence`, `getDatabaseClient`, `DATABASE_URL`) authenticates as a
// role with `rolbypassrls = true`, so RLS is inert there and the ONLY thing standing
// between a merchant and another tenant's rows is a `business_id = $n` predicate in
// the SQL itself.
//
// `assertTenantSafe` (lib/database/postgres-client.ts) only substring-matches for
// `business_id`, `where id`, or `count(*)`. This script is a stricter, reviewable
// approximation: it flags every `.query(`/`.execute(` call under modules/ whose SQL
// text does not mention `business_id`.
//
// It is a REVIEW AID, not a proof. It cannot see through string concatenation,
// helper indirection, or dynamic identifiers, and it will not flag a query that
// mentions `business_id` while binding the wrong value. Confirm every hit by hand.
//
// Usage:
//   node .agents/skills/tenant-isolation-review/scripts/scan-tenant-safety.mjs
//   node .agents/skills/tenant-isolation-review/scripts/scan-tenant-safety.mjs --json
//
// Exit codes: 0 = no candidates, 1 = candidates found (review required), 2 = bad usage.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = join(SKILL_DIR, '..', '..', '..', '..');
const SCAN_ROOTS = ['modules', 'lib/database', 'lib/http/wiring.ts', 'lib/ai'];

// Paths where a raw query is expected and reviewed by design:
//  - lib/database/postgres-client.ts IS the client; tenant filtering is deliberately
//    NOT injected here (see its own header comment) — the caller must add the predicate.
//  - lib/ai/tools/registry.ts is tool dispatch, not SQL construction.
const EXEMPT_PREFIXES = [
  'modules/rag/infrastructure', // its own tenant SQL is asserted by tests/rag/tenant-guard
  'lib/database/postgres-client.ts',
  'lib/ai/tools/registry.ts',
];

const args = process.argv.slice(2);
const asJson = args.includes('--json');
if (args.some((a) => !['--json', '--help', '-h'].includes(a))) {
  console.error('usage: scan-tenant-safety.mjs [--json]');
  process.exit(2);
}
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: scan-tenant-safety.mjs [--json]');
  process.exit(0);
}

async function collectFiles(target) {
  const abs = join(REPO_ROOT, target);
  let info;
  try {
    info = await stat(abs);
  } catch {
    return []; // path does not exist — nothing to scan
  }
  if (info.isFile()) return ['.ts', '.tsx', '.mjs'].includes(extname(abs)) ? [abs] : [];

  const out = [];
  for (const entry of await readdir(abs, { withFileTypes: true })) {
    const child = join(abs, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'fixtures') continue;
      out.push(...(await collectFiles(relative(REPO_ROOT, child))));
    } else if (['.ts', '.tsx', '.mjs'].includes(extname(entry.name))) {
      out.push(child);
    }
  }
  return out;
}

/**
 * Finds `.query(` / `.execute(` call sites and reports whether the tenant appears
 * either in the SQL text or in the bound arguments. Deliberately simple: the goal
 * is a short, reviewable list, not a parser.
 *
 * Expect false positives where the SQL lives in a module-level `*_SQL` constant —
 * those are exactly the call sites worth eyeballing once, but a hit is a prompt to
 * verify, never a verdict.
 */
function inspect(source, file) {
  const findings = [];
  // Match `<receiver>.query(` / `<receiver>.execute(`. The receiver must be read so we
  // can skip non-database callees that happen to share the method name — notably
  // ActionExecutor.execute(), which dispatches an action, not SQL.
  const pattern = /([A-Za-z_$][\w$]*)\s*\.\s*(query|execute)\s*\(/g;
  const NON_DB_RECEIVERS = /executor|registry|bus/i;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const receiver = match[1];
    if (NON_DB_RECEIVERS.test(receiver)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    const window = source.slice(match.index, match.index + 600);
    const mentionsTenant = /business_?id/i.test(window);
    if (!mentionsTenant) {
      findings.push({
        file,
        line,
        receiver,
        method: match[2],
        snippet: window.split('\n')[0].trim().slice(0, 100),
      });
    }
  }
  return findings;
}

const files = (await Promise.all(SCAN_ROOTS.map(collectFiles))).flat();
const all = [];
for (const file of files) {
  const rel = relative(REPO_ROOT, file);
  if (EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) continue;
  const source = await readFile(file, 'utf8');
  if (!/\.(query|execute)\s*\(/.test(source)) continue;
  all.push(...inspect(source, rel));
}

if (asJson) {
  console.log(JSON.stringify({ scannedFiles: files.length, candidates: all.length, findings: all }, null, 2));
} else {
  console.log(`scanned ${files.length} file(s) under ${SCAN_ROOTS.join(', ')}`);
  if (all.length === 0) {
    console.log('no candidates: every raw query mentions business_id');
  } else {
    console.log(`\n${all.length} raw query call site(s) WITHOUT a nearby business_id predicate:\n`);
    for (const f of all) {
      console.log(`  ${f.file}:${f.line}  ${f.receiver}.${f.method}(  ${f.snippet}`);
    }
    console.log('\nThese run with RLS bypassed. For each one, confirm by hand that the');
    console.log('tenant is bound from the authenticated context and cannot be influenced');
    console.log('by request input. If the query legitimately needs no tenant filter,');
    console.log(`add its path to EXEMPT_PREFIXES in ${relative(REPO_ROOT, join(SKILL_DIR, 'scan-tenant-safety.mjs'))}`);
    console.log('with a comment explaining why.');
  }
}

process.exit(all.length > 0 ? 1 : 0);
