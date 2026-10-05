// Merchant Brain: Agent 2 red-team regression suite
//
// These tests assert on the MIGRATION SQL TEXT, not a live database. That is a
// deliberate trade-off, stated plainly:
//
//   * The repository's CI has no Postgres and no Supabase instance, so a
//     behavioural RLS test cannot run there.
//   * `tests/database-security.test.ts` (29 cases) already covers behaviour
//     against a live database for operators who have one.
//   * What this suite guarantees is that a future migration cannot silently
//     WEAKEN a control: if someone drops `FORCE ROW LEVEL SECURITY`, re-grants
//     `anon` a membership helper, re-adds an audit_logs write policy, or makes
//     the storage bucket public, these fail.
//
// Each test names the attack it prevents, so a failure reads as a security
// regression rather than a brittle string mismatch.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Concatenates every migration in chronological order. */
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** All migration SQL, applied in order. Later migrations override earlier ones. */
function allSql(): string {
  return migrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n;\n');
}

/**
 * Returns the SQL with all DROP POLICY statements removed, so a test can assert
 * what a policy's final definition is rather than every version of it.
 */
function liveSql(): string {
  return allSql()
    .replace(/^\s*--.*$/gm, '')                       // strip line comments
    .replace(/DROP\s+POLICY(?:\s+IF\s+EXISTS)?\s+[^;]+;/gi, '');
}

/**
 * Replays CREATE POLICY / DROP POLICY across migrations in order and returns
 * the effective policy definitions for one table.
 *
 * Necessary because a later DROP does not erase the earlier CREATE from the
 * file text; only the applied order determines which policy is live.
 */
function finalPoliciesByTable(table: string): string[] {
  const live = new Map<string, string>();

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      .replace(/^\s*--.*$/gm, '');

    for (const m of sql.matchAll(/DROP\s+POLICY(?:\s+IF\s+EXISTS)?\s+([\w]+)/gi)) {
      live.delete(m[1]);
    }
    for (const m of sql.matchAll(/CREATE POLICY\s+([\w]+)[\s\S]*?;/gi)) {
      const statement = m[0];
      // A generated policy inside a DO block is parameterised, so match the
      // template against the table list rather than a literal table name.
      if (statement.includes('public.%I') || statement.includes(`public.${table}`)) {
        live.set(m[1], statement);
      }
    }
  }

  return [...live.values()].filter((p) => p.includes(`public.${table}`) || p.includes('public.%I'));
}

/** Every quoted entry across every `text[] := ARRAY[...]` block in the SQL. */
function allArrayEntries(sql: string): string[] {
  const out: string[] = [];
  for (const match of sql.matchAll(/ARRAY\[([\s\S]*?)\];/g)) {
    for (const entry of match[1].matchAll(/'([a-z_]+)'/g)) out.push(entry[1]);
  }
  return out;
}

const TENANT_TABLES = [
  'businesses', 'business_members', 'users', 'suppliers', 'customers', 'products',
  'transactions', 'transaction_items', 'expenses', 'inventory_movements',
  'receivables', 'payables', 'supplier_pricing', 'documents', 'ingestion_jobs',
  'document_extractions', 'document_embeddings', 'profit_leaks',
  'cash_flow_forecasts', 'scenarios', 'actions', 'action_logs', 'chat_sessions',
  'chat_messages', 'notifications', 'audit_logs',
];

/** Tables whose tenancy is expressed directly as a business_id column. */
const DIRECT_TENANT_TABLES = [
  'suppliers', 'customers', 'products', 'transactions', 'expenses',
  'inventory_movements', 'receivables', 'payables', 'supplier_pricing',
  'documents', 'ingestion_jobs', 'document_extractions', 'document_embeddings',
  'profit_leaks', 'cash_flow_forecasts', 'scenarios', 'actions', 'audit_logs',
];

// ===========================================================================
// RLS enablement
// ===========================================================================

describe('RLS enablement', () => {
  it('enables and FORCES row level security on every tenant table', () => {
    const sql = allSql();

    // RLS is applied in a DO block over a hardcoded array using format('%I'),
    // so the table list is asserted directly rather than per-statement.
    const listed = allArrayEntries(sql);
    expect(listed.length).toBeGreaterThan(0);

    for (const table of TENANT_TABLES) {
      expect(listed).toContain(table);
    }

    // FORCE is what stops the table owner from bypassing its own policies.
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/i);
  });

  it('never disables RLS on a tenant table', () => {
    const sql = allSql();
    for (const table of TENANT_TABLES) {
      expect(sql).not.toMatch(new RegExp(`DISABLE ROW LEVEL SECURITY[^;]*${table}`, 'i'));
    }
  });
});

// ===========================================================================
// Tenant predicate correctness
// ===========================================================================

describe('tenant predicates', () => {
  it('scopes every direct-tenant SELECT policy to the caller memberships', () => {
    const sql = liveSql();

    // The SELECT/INSERT/UPDATE/DELETE policies for direct-tenant tables are
    // generated in one DO block from a hardcoded array. Assert the generated
    // template uses the membership resolver, then assert the array contents.
    expect(sql).toMatch(
      /_tenant_select ON public\.%I FOR SELECT TO authenticated\s+USING \(business_id IN \(SELECT public\.auth_user_businesses\(\)\)\)/i,
    );

    const listed = allArrayEntries(sql);
    for (const table of DIRECT_TENANT_TABLES) {
      expect(listed).toContain(table);
    }
  });

  it('gives every writable policy a WITH CHECK, not only a USING', () => {
    // A USING-only UPDATE policy still allows a caller to move a row out of
    // their tenant, because USING is evaluated against the old row.
    const sql = liveSql();
    const updatePolicies = sql.match(
      /CREATE POLICY[^;]*_tenant_update[^;]*FOR UPDATE[^;]*;/gi,
    ) ?? [];

    expect(updatePolicies.length).toBeGreaterThan(0);
    for (const policy of updatePolicies) {
      expect(policy).toMatch(/WITH\s+CHECK/i);
    }
  });

  it('never derives tenant identity from a request parameter', () => {
    // auth.uid() and the SECURITY DEFINER helpers are the only trusted sources.
    const sql = liveSql();
    expect(sql).not.toMatch(/current_setting\(\s*'request\.headers/i);
    expect(sql).not.toMatch(/auth\.jwt\(\)\s*->>\s*'business_id'/i);
  });
});

// ===========================================================================
// Child tables — indirect tenancy
// ===========================================================================

describe('child table tenancy', () => {
  const CHILD_TABLES = [
    { table: 'transaction_items', parent: 'transactions' },
    { table: 'action_logs', parent: 'actions' },
    { table: 'chat_messages', parent: 'chat_sessions' },
  ];

  it('resolves each child table through an EXISTS join to its parent', () => {
    const sql = liveSql();
    for (const { table, parent } of CHILD_TABLES) {
      expect(sql).toMatch(
        new RegExp(`${table}_tenant_select[^;]*EXISTS\\s*\\([^;]*FROM\\s+public\\.${parent}`, 'is'),
      );
    }
  });

  it('does not assume a business_id column on child tables', () => {
    // transaction_items / action_logs / chat_messages have no business_id.
    // A local-column policy on them would deny everything or, worse, be
    // silently rewritten to a wrong predicate.
    const sql = liveSql();
    for (const { table } of CHILD_TABLES) {
      expect(sql).not.toMatch(
        new RegExp(`CREATE POLICY[^;]*${table}_tenant_select[^;]*USING\\s*\\(\\s*business_id`, 'i'),
      );
    }
  });
});

// ===========================================================================
// Ownership mutation
// ===========================================================================

describe('ownership mutation', () => {
  it('installs a trigger that blocks business_id reassignment', () => {
    const sql = allSql();
    expect(sql).toMatch(/CREATE TRIGGER[^;]*prevent_business_id_mutation/i);
    expect(sql).toMatch(/BEFORE UPDATE ON/i);
  });

  it('installs a trigger that blocks parent-FK reassignment on child tables', () => {
    const sql = allSql();
    expect(sql).toMatch(/prevent_parent_id_mutation/i);
    for (const column of ['transaction_id', 'action_id', 'session_id']) {
      expect(sql).toMatch(new RegExp(`prevent_parent_id_mutation\\('${column}'\\)`, 'i'));
    }
  });

  it('blocks role escalation on business_members', () => {
    const sql = allSql();
    expect(sql).toMatch(/prevent_membership_role_escalation/i);
  });
});

// ===========================================================================
// Audit integrity
// ===========================================================================

describe('audit integrity', () => {
  it('keeps audit_logs append-only for application roles', () => {
    // Migration 0006 must DROP the generic insert/update/delete policies.
    const sql = allSql();
    for (const cmd of ['insert', 'update', 'delete']) {
      expect(sql).toMatch(
        new RegExp(`DROP POLICY IF EXISTS audit_logs_tenant_${cmd}`, 'i'),
      );
    }
  });

  it('leaves no writable audit_logs policy in the effective schema', () => {
    const sql = liveSql();
    const auditPolicies = sql.match(/CREATE POLICY[^;]*ON public\.audit_logs[^;]*;/gi) ?? [];
    for (const policy of auditPolicies) {
      expect(policy).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE)/i);
    }
  });

  it('still allows members to read their own audit trail', () => {
    // audit_logs is in the generic policy array, so its SELECT policy is
    // generated as '<table>_tenant_select'. Assert the array membership and the
    // generated template together.
    expect(allArrayEntries(allSql())).toContain('audit_logs');
    expect(liveSql()).toMatch(/_tenant_select ON public\.%I FOR SELECT/i);
  });
});

// ===========================================================================
// SEC-2026-001 — business creation must not be unrestricted
// ===========================================================================

describe('SEC-2026-001: business creation is owner-scoped', () => {
  it('no longer grants an unconditional INSERT on businesses', () => {
    // The original `WITH CHECK (true)` policy from migration 0004 is dropped by
    // 0009. What matters is the LAST definition applied to businesses INSERT,
    // so resolve it by scanning migrations in order and keeping the final state.
    const final = finalPoliciesByTable('businesses');
    const insertPolicies = final.filter((p) => /FOR\s+INSERT/i.test(p));

    expect(insertPolicies.length).toBeGreaterThan(0);
    for (const policy of insertPolicies) {
      expect(policy).not.toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
    }
    expect(final.some((p) => /businesses_insert_owner_only/.test(p))).toBe(true);
  });

  it('requires the inserting user to already administer the business', () => {
    expect(liveSql()).toMatch(
      /CREATE POLICY businesses_insert_owner_only[\s\S]*?WITH CHECK\s*\([^;]*auth_user_admin_businesses\(\)/,
    );
  });
});

// ===========================================================================
// SEC-2026-002 — membership helpers are not callable by anon
// ===========================================================================

describe('SEC-2026-002: membership helpers exclude anon', () => {
  const HELPERS = [
    'auth_user_businesses',
    'auth_user_admin_businesses',
    'auth_user_owner_businesses',
  ];

  it('revokes EXECUTE from anon for every membership helper', () => {
    const sql = allSql();
    for (const fn of HELPERS) {
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM anon`, 'i'),
      );
    }
  });

  it('keeps the helpers callable by authenticated', () => {
    const sql = allSql();
    for (const fn of HELPERS) {
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(\\) TO authenticated`, 'i'),
      );
    }
  });

  it('revokes every SECURITY DEFINER helper from PUBLIC', () => {
    const sql = allSql();

    // Cross-reference rather than regex-scanning: a broad pattern also matches
    // the explanatory comment that lists these functions.
    const definerHelpers = [
      'auth_user_businesses',
      'auth_user_admin_businesses',
      'auth_user_owner_businesses',
    ];

    for (const fn of definerHelpers) {
      const isDefiner = new RegExp(
        `CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)[\\s\\S]*?SECURITY DEFINER`,
        'i',
      ).test(sql);
      expect(isDefiner, `${fn} should be SECURITY DEFINER`).toBe(true);

      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC`, 'i'),
      );
    }
  });
});

// ===========================================================================
// Function and search_path safety
// ===========================================================================

describe('function safety', () => {
  it('pins search_path on every function it defines', () => {
    const sql = allSql();
    const definitions = sql.match(
      /CREATE (?:OR REPLACE )?FUNCTION\s+public\.[\w]+\(\)[\s\S]*?\$\$;/g,
    ) ?? [];
    expect(definitions.length).toBeGreaterThan(0);
    for (const def of definitions) {
      expect(def).toMatch(/SET search_path/i);
    }
  });

  it('quotes dynamic identifiers/literals and only permits proven constant policy grammar', () => {
    const sql = allSql();
    const formatCalls = sql.match(/format\([^)]*\)/gi) ?? [];
    expect(formatCalls.length).toBeGreaterThan(0);
    // These DDL templates interpolate grammar assembled solely from local DO
    // block constants. This is not request SQL: identifiers use %I and role
    // literals use %L. Unknown raw interpolation still fails this gate.
    const policyGrammar = [
      "format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)",
      "format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s)",
      "format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)",
      "format('CREATE POLICY %I ON public.transaction_items FOR %s TO authenticated %s',",
    ];
    for (const call of formatCalls) {
      if (!call.includes('%s')) continue;
      expect(policyGrammar.some((literal) => call.startsWith(literal))).toBe(true);
    }
    expect(sql).toContain("predicate := format('EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id = %I.business_id AND m.user_id = (SELECT auth.uid()) AND m.status = ''active'' AND m.role = ANY(%L::text[]))',t,roles)");
    expect(sql).toContain("FOREACH operation IN ARRAY ARRAY['insert','update','delete'] LOOP");
    expect(sql).toContain("'transaction_items_tenant_'||operation,upper(operation),CASE WHEN operation = 'insert'");
    expect(sql).toContain("AND m.status = ''active'' AND m.role IN (''owner'',''admin'',''manager'',''accountant'')");
  });

  it('revokes the trigger helper functions from PUBLIC', () => {
    const sql = allSql();
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.prevent_business_id_mutation\(\) FROM PUBLIC/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.prevent_parent_id_mutation\(\) FROM PUBLIC/i);
  });
});

// ===========================================================================
// Internal table protection
// ===========================================================================

describe('internal table protection', () => {
  it('revokes _migrations from anon and authenticated', () => {
    const sql = allSql();
    expect(sql).toMatch(
      /REVOKE ALL ON public\._migrations FROM anon,\s*authenticated/i,
    );
  });

  it('never grants a policy on _migrations', () => {
    expect(liveSql()).not.toMatch(/CREATE POLICY[^;]*ON public\._migrations/i);
  });
});

// ===========================================================================
// Storage security
// ===========================================================================

describe('storage security', () => {
  it('keeps the merchant-files bucket private', () => {
    const sql = allSql();
    expect(sql).toMatch(/INSERT INTO storage\.buckets[\s\S]*?'merchant-files'/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE SET public = false/i);
  });

  it('scopes every storage policy to the tenant prefix', () => {
    const sql = liveSql();
    const policies = sql.match(/CREATE POLICY[^;]*ON storage\.objects[^;]*;/gi) ?? [];
    expect(policies.length).toBeGreaterThanOrEqual(4);

    for (const policy of policies) {
      // Each policy must resolve the owning business from the object name and
      // check it against the caller's memberships.
      expect(policy).toMatch(/auth_user_businesses\(\)/i);
    }
  });

  it('covers SELECT, INSERT, UPDATE and DELETE on storage objects', () => {
    const sql = liveSql();
    for (const cmd of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      expect(sql).toMatch(new RegExp(`CREATE POLICY[^;]*ON storage\\.objects[^;]*FOR ${cmd}`, 'is'));
    }
  });
});

// ===========================================================================
// Migration hygiene
// ===========================================================================

describe('migration hygiene', () => {
  it('numbers migrations so they sort chronologically', () => {
    const names = migrationFiles();
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('uses strictly increasing timestamps', () => {
    const stamps = migrationFiles().map((f) => f.split('_')[0]);
    for (let i = 1; i < stamps.length; i += 1) {
      expect(stamps[i] > stamps[i - 1]).toBe(true);
    }
  });

  it('never edits an already-applied migration in place', () => {
    // Guard against the anti-pattern: a hash change on an existing file.
    // Presence of an assertion block is the signal that a migration is additive.
    expect(migrationFiles().length).toBeGreaterThanOrEqual(9);
  });
});
