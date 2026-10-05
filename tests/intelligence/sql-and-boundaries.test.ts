import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { isAllowedImport, MODULE_DEPENDENCIES } from '@/lib/boundaries';

// ---------------------------------------------------------------------------
// SQL source lint
//
// These text checks only inspect selected *_SQL constants, not all executed SQL.
// A regex is not a SQL parser or an authorization boundary. Tenant isolation is
// exercised by tests/production-tenant-isolation.test.ts on BYPASSRLS raw PG and
// tests/database-security*.test.ts under authenticated RLS, with actual DB env.
// ---------------------------------------------------------------------------

const MODULES_DIR = join(process.cwd(), 'modules');

function readModuleSources(): { file: string; source: string }[] {
  const out: { file: string; source: string }[] = [];
  for (const moduleName of readdirSync(MODULES_DIR)) {
    const moduleDir = join(MODULES_DIR, moduleName);
    if (!statSync(moduleDir).isDirectory()) continue;
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts')) {
          out.push({ file: relative(process.cwd(), full).replace(/\\/g, '/'), source: readFileSync(full, 'utf-8') });
        }
      }
    };
    walk(moduleDir);
  }
  return out;
}

/** Extracts every SQL literal assigned to a `*_SQL` constant. */
function extractSqlLiterals(source: string): { name: string; sql: string }[] {
  const statements: { name: string; sql: string }[] = [];
  const pattern = /const\s+([A-Z0-9_]*SQL)\s*=\s*`([\s\S]*?)`;/g;
  let match = pattern.exec(source);
  while (match !== null) {
    statements.push({ name: match[1] as string, sql: match[2] as string });
    match = pattern.exec(source);
  }
  return statements;
}

const SOURCES = readModuleSources();

describe('SQL source lint in intelligence modules (not isolation proof)', () => {
  const owned = SOURCES.filter((entry) =>
    /modules\/(analytics|cash-flow|profit-leaks|simulator|actions|notifications)\//.test(entry.file),
  );
  const statements = owned.flatMap((entry) =>
    extractSqlLiterals(entry.source).map((statement) => ({ ...statement, file: entry.file })),
  );

  it('finds the owned persistence statements to verify', () => {
    expect(statements.length).toBeGreaterThan(15);
  });

  it('binds every identifier through a placeholder instead of interpolating it', () => {
    // Interpolation of an internal column-list constant is fine; interpolating
    // anything derived from a caller is not.
    const allowed = /^\$\{[A-Z_]+\}$/;
    for (const statement of statements) {
      const interpolations = [...statement.sql.matchAll(/\$\{[^}]*\}/g)].map((match) => match[0]);
      for (const interpolation of interpolations) {
        expect(interpolation, `${statement.file}:${statement.name}`).toMatch(allowed);
      }
    }
  });

  it('never spells a bare column name where a placeholder is required', () => {
    for (const statement of statements) {
      const withoutPlaceholders = statement.sql.replace(/\$\d+/g, '');
      expect(withoutPlaceholders, `${statement.file}:${statement.name}`).not.toMatch(
        /\bbusiness_id\s*=\s*'/i,
      );
    }
  });

  it('bounds every statement that returns tenant rows', () => {
    for (const statement of statements) {
      const sql = statement.sql;
      if (/^\s*INSERT/i.test(sql.trim())) continue;
      if (/GROUP\s+BY/i.test(sql)) continue;
      // An ungrouped aggregate already returns exactly one row, so LIMIT adds nothing.
      if (!/GROUP\s+BY/i.test(sql) && /\b(COUNT|SUM|MIN|MAX)\s*\(/i.test(sql)) continue;
      // This specific action capability lookup selects by actions.id (a primary
      // key). Its cardinality is <= 1 by schema, with no LIMIT needed. Do not
      // generalize this into a regex that pretends to infer SQL cardinality.
      if (statement.file === 'modules/actions/infrastructure/internal-action-capabilities.ts' &&
          statement.name === 'CLAIMED_SQL') continue;
      if (!/\bFROM\s+[a-z_]+/i.test(sql)) continue;
      // A sum from the beginning of the ledger is bounded by definition.
      if (/\bLIMIT\s+1\b/i.test(sql)) continue;
      expect(sql, `${statement.file}:${statement.name} must be bounded`).toMatch(/\bLIMIT\b/i);
    }
  });

  it('binds every LIMIT as a parameter rather than inlining a number', () => {
    for (const statement of statements) {
      const limits = [...statement.sql.matchAll(/LIMIT\s+([^\s;)]+)/gi)].map((match) => match[1]);
      for (const limit of limits) {
        expect(limit, `${statement.file}:${statement.name} LIMIT must be bound`).toMatch(
          /^\$\d+$|^1$|^LEAST\(/i,
        );
      }
    }
  });

  it('clamps the caller-supplied page size inside the application service', async () => {
    const { PostgresProfitLeakService } = await import('@/modules/profit-leaks');
    const {
      InMemoryAnalyticsRepository,
      TENANT_A,
      fixedClockAt,
      tenantFor,
    } = await import('./support/doubles');
    const { InMemoryProfitLeakRepository } = await import('./support/action-doubles');
    const { PostgresAnalyticsService } = await import('@/modules/analytics');
    const analytics = new PostgresAnalyticsService(
      new InMemoryAnalyticsRepository({ sales: [], expenses: [], products: [] }),
      fixedClockAt('2026-02-01T00:00:00.000Z'),
    );
    const repository = new InMemoryProfitLeakRepository();
    const service = new PostgresProfitLeakService(repository, analytics, fixedClockAt('2026-02-01T00:00:00.000Z'));
    const result = await service.list(tenantFor(TENANT_A), { page: 1, limit: 100_000 });
    expect(result.limit).toBeLessThanOrEqual(100);
  });

  it('uses half-open period predicates so adjacent periods cannot double count', () => {
    for (const statement of statements) {
      const sql = statement.sql;
      if (!/\btransaction_date\b|\bexpense_date\b/.test(sql)) continue;
      // The upper bound is always present and always exclusive.
      expect(sql, `${statement.file}:${statement.name}`).toMatch(/<\s*\$\d+/);
      expect(sql, `${statement.file}:${statement.name}`).not.toMatch(/<=\s*\$\d+/);
      // A lower bound, when present, must be inclusive and bound.
      if (/>\s*\$\d+/.test(sql)) {
        expect(sql, `${statement.file}:${statement.name}`).toMatch(/>=\s*\$\d+/);
      }
    }
  });

  it('escapes the text-array bind format so a crafted status cannot inject SQL', async () => {
    const { __testing } = await import(
      '@/modules/analytics/infrastructure/postgres-analytics-repository'
    );
    // A value containing a quote and a statement terminator stays inside the array literal.
    // A value that could break out of the array literal is refused outright rather
    // than escaped into a different string than the caller compared against.
    expect(() => __testing.asTextArrayLiteral(['a"; DROP TABLE actions; --'])).toThrow(
      /Refusing to bind/,
    );
    expect(() => __testing.asTextArrayLiteral(["a' OR '1'='1"])).toThrow(/Refusing to bind/);
    expect(__testing.asTextArrayLiteral(['completed', 'confirmed'])).toBe('{"completed","confirmed"}');
  });

  it('guards the single-winner execution claim on its precondition', () => {
    const source = readFileSync(join(process.cwd(), 'modules/actions/infrastructure/postgres-action-repository.ts'), 'utf-8');
    const claim = extractSqlLiterals(source).find((entry) => entry.name === 'CLAIM_SQL');
    expect(claim).toBeDefined();
    expect(claim?.sql).toMatch(/SET\s+status\s*=\s*'executing'/i);
    expect(claim?.sql).toMatch(/AND\s+status\s*=\s*'approved'/i);
    expect(claim?.sql).toMatch(/business_id\s*=\s*\$1/i);
  });

  it('guards approval on the awaiting-approval precondition', () => {
    const source = readFileSync(join(process.cwd(), 'modules/actions/infrastructure/postgres-action-repository.ts'), 'utf-8');
    const approval = extractSqlLiterals(source).find((entry) => entry.name === 'RECORD_APPROVAL_SQL');
    expect(approval?.sql).toMatch(/AND\s+status\s*=\s*'awaiting_approval'/i);
  });

  it('holds the action parameter hash in the row so tampering is detectable', () => {
    const source = readFileSync(join(process.cwd(), 'modules/actions/infrastructure/postgres-action-repository.ts'), 'utf-8');
    expect(source).toMatch(/detail\s*->>?'parametersHash'/);
  });

  it('contains no write path to a ledger table in the analytics or cash-flow layer', () => {
    for (const entry of owned) {
      if (!/modules\/(analytics|cash-flow)\//.test(entry.file)) continue;
      expect(entry.source, `${entry.file} must be read-only`).not.toMatch(
        /INSERT\s+INTO\s+(transactions|transaction_items|expenses|products|inventory_movements|receivables|payables)/i,
      );
      expect(entry.source, `${entry.file} must be read-only`).not.toMatch(
        /UPDATE\s+(transactions|transaction_items|expenses|products|inventory_movements|receivables|payables)/i,
      );
    }
  });

  it('contains no write path to a ledger table in the simulator', () => {
    const simulator = owned.filter((entry) => /modules\/simulator\//.test(entry.file));
    for (const entry of simulator) {
      expect(entry.source, `${entry.file} must not mutate business data`).not.toMatch(
        /INSERT\s+INTO\s+(?!scenarios)/i,
      );
      expect(entry.source, `${entry.file} must not mutate business data`).not.toMatch(
        /UPDATE\s+(transactions|transaction_items|expenses|products|inventory_movements|receivables|payables|scenarios)/i,
      );
      expect(entry.source, `${entry.file} must not delete`).not.toMatch(/\bDELETE\s+FROM\b/i);
    }
  });

  it('uses no dynamic code execution anywhere in the owned modules', () => {
    for (const entry of owned) {
      expect(entry.source, `${entry.file} must not use eval`).not.toMatch(/\beval\s*\(/);
      expect(entry.source, `${entry.file} must not use new Function`).not.toMatch(/new\s+Function\s*\(/);
      expect(entry.source, `${entry.file} must not shell out`).not.toMatch(
        /child_process|execSync|spawnSync|execFileSync/,
      );
    }
  });

  it('uses no caller-controlled dynamic module resolution', () => {
    for (const entry of owned) {
      expect(entry.source, `${entry.file} must not resolve modules dynamically`).not.toMatch(
        /\b(?:require|import)\s*\(\s*[^'"\s)]/,
      );
    }
  });

  it('never fetches an arbitrary URL derived from action or scenario input', () => {
    for (const entry of owned) {
      expect(entry.source, `${entry.file} must not fetch arbitrary URLs`).not.toMatch(
        /\bfetch\s*\(\s*(?!')/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Import boundaries
// ---------------------------------------------------------------------------

describe('module import boundaries in real source', () => {
  const sources = readModuleSources();

  it('keeps every cross-module import within the declared dependency graph', () => {
    const violations: string[] = [];
    for (const entry of sources) {
      const fromModule = entry.file.split('/')[1] as string;
      if (!(fromModule in MODULE_DEPENDENCIES)) continue;
      const pattern = /from\s+'@\/modules\/([a-z-]+)/g;
      let match = pattern.exec(entry.source);
      while (match !== null) {
        const toModule = match[1] as string;
        if (!isAllowedImport(fromModule, toModule)) {
          violations.push(`${entry.file} imports @/modules/${toModule}`);
        }
        match = pattern.exec(entry.source);
      }
    }
    expect(violations).toEqual([]);
  });

  it('keeps the actions module free of sibling dependencies, as the graph requires', () => {
    expect(MODULE_DEPENDENCIES.actions).toEqual([]);
    for (const entry of sources) {
      if (!entry.file.includes('modules/actions/')) continue;
      expect(entry.source, `${entry.file} must not import a sibling module`).not.toMatch(
        /from\s+'@\/modules\/(?!actions)/,
      );
    }
  });

  it('keeps the notifications module free of sibling dependencies', () => {
    expect(MODULE_DEPENDENCIES.notifications).toEqual([]);
    for (const entry of sources) {
      if (!entry.file.includes('modules/notifications/')) continue;
      expect(entry.source, `${entry.file} must not import a sibling module`).not.toMatch(
        /from\s+'@\/modules\/(?!notifications)/,
      );
    }
  });

  it('lets a consumer reach every owned contract only through the public barrel', () => {
    const barrels = [
      'analytics',
      'cash-flow',
      'profit-leaks',
      'simulator',
      'actions',
      'notifications',
    ];
    for (const name of barrels) {
      const barrel = join(MODULES_DIR, name, 'index.ts');
      expect(statSync(barrel).isFile(), `${name} must expose index.ts`).toBe(true);
    }
  });

  it('keeps internals out of the barrels as deep relative re-exports', () => {
    for (const name of ['analytics', 'cash-flow', 'profit-leaks', 'simulator', 'actions']) {
      const source = readFileSync(join(MODULES_DIR, name, 'index.ts'), 'utf-8');
      const deep = [...source.matchAll(/from\s+'\.\/(domain|application|infrastructure)\/([^']+)'/g)];
      for (const match of deep) {
        const target = match[2] as string;
        expect(
          target.endsWith('/index'),
          `${name}/index.ts must not re-export an internal path that consumers could reach: ${target}`,
        ).toBe(false);
      }
    }
  });

  it('keeps the owned module graph acyclic', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (name: string, trail: string[]): void => {
      if (visiting.has(name)) throw new Error(`cycle: ${[...trail, name].join(' -> ')}`);
      if (done.has(name)) return;
      visiting.add(name);
      for (const dependency of MODULE_DEPENDENCIES[name] ?? []) visit(dependency, [...trail, name]);
      visiting.delete(name);
      done.add(name);
    };
    for (const name of Object.keys(MODULE_DEPENDENCIES)) {
      expect(() => visit(name, [])).not.toThrow();
    }
  });
});
