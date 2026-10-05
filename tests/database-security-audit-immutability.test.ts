import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// Audit-trail immutability — regression coverage for migration
// 20261002000012_audit_immutability_and_rag_search_path.sql.
//
// BEFORE that migration, `action_logs` carried UPDATE and DELETE policies for any
// active member of the parent action's tenant (from 0004), and when 0011 added a
// denormalised `business_id` column it added neither a policy validating it nor a
// business_id immutability trigger. A tenant member could therefore relabel audit
// rows into another tenant, rewrite them, or delete them.
//
// These tests assert the four attack vectors are denied, and that the RAG
// retrieval function still executes with its search_path pinned.
//
// Runs against LOCAL Supabase only; skipped without LOCAL_DATABASE_URL, exactly
// like tests/database-security.test.ts.

const LOCAL_DB = process.env.LOCAL_DATABASE_URL;
const describeDb = LOCAL_DB ? describe : describe.skip;

// Deliberately distinct from the fixtures in tests/database-security.test.ts.
// That suite creates and DELETEs rows with its own ids in afterAll; sharing them
// would let one file's teardown destroy the other's fixtures and produce failures
// that look like security regressions but are pure test cross-talk.
const BIZ_A = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const BIZ_B = 'aaaaaaaa-0000-4000-8000-0000000000b2';
const USER_A = 'bbbbbbbb-0000-4000-8000-0000000000a1';
const USER_B = 'bbbbbbbb-0000-4000-8000-0000000000b2';
const ACTION_A = 'ffffffff-0000-4000-8000-0000000000a1';

let client: pg.Client;

async function asUser(userId: string, fn: (c: pg.Client) => Promise<unknown>) {
  await client.query('SET ROLE authenticated');
  await client.query(`SELECT set_config('request.jwt.claim.sub', '${userId}', false)`);
  try {
    return await fn(client);
  } finally {
    await client.query('RESET ROLE');
    await client.query(`SELECT set_config('request.jwt.claim.sub', '', false)`);
  }
}

beforeAll(async () => {
  client = new pg.Client({ connectionString: LOCAL_DB });
  await client.connect();

  await client.query(
    `INSERT INTO businesses (id, name, type, status) VALUES
       ('${BIZ_A}', 'Audit Fixture A', 'retail', 'active'),
       ('${BIZ_B}', 'Audit Fixture B', 'retail', 'active')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO users (id, email, name) VALUES
       ('${USER_A}', 'audit-immut-a@example.test', 'Audit A'),
       ('${USER_B}', 'audit-immut-b@example.test', 'Audit B')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO business_members (business_id, user_id, role, status) VALUES
       ('${BIZ_A}', '${USER_A}', 'owner', 'active'),
       ('${BIZ_B}', '${USER_B}', 'owner', 'active')
     ON CONFLICT DO NOTHING`,
  );
  await client.query(
    `INSERT INTO actions (id, business_id, type, title, description, status, source, parameters, created_by)
     VALUES ('${ACTION_A}', '${BIZ_A}', 'send_reminder', 'fixture', 'fixture', 'approved', 'manual', '{}', '${USER_A}')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO action_logs (action_id, business_id, outcome, from_status, to_status,
                              actor_id, actor_role, parameters_hash, correlation_id)
     VALUES ('${ACTION_A}', '${BIZ_A}', 'allowed', 'proposed', 'approved',
             '${USER_A}', 'owner', 'hash-fixture', 'corr-audit-immut-001')
     ON CONFLICT DO NOTHING`,
  );
});

afterAll(async () => {
  if (!client) return;
  try {
    await client
      .query(`DELETE FROM action_logs WHERE correlation_id = 'corr-audit-immut-001'`)
      .catch(() => undefined);
    await client.query(`DELETE FROM actions WHERE id = '${ACTION_A}'`).catch(() => undefined);
    await client
      .query(`DELETE FROM business_members WHERE business_id IN ('${BIZ_A}', '${BIZ_B}')`)
      .catch(() => undefined);
    await client
      .query(`DELETE FROM users WHERE id IN ('${USER_A}', '${USER_B}')`)
      .catch(() => undefined);
    await client
      .query(`DELETE FROM businesses WHERE id IN ('${BIZ_A}', '${BIZ_B}')`)
      .catch(() => undefined);
  } finally {
    await client.end().catch(() => undefined);
  }
});

describeDb('action_logs is append-only (migration 0012)', () => {
  it('has no UPDATE or DELETE policy', async () => {
    const result = await client.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'action_logs'
          AND policyname IN ('action_logs_tenant_update', 'action_logs_tenant_delete')`,
    );
    expect(result.rows).toHaveLength(0);
  });

  it('carries a business_id immutability trigger', async () => {
    const result = await client.query(
      `SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.action_logs'::regclass
          AND tgname = 'trg_action_logs_business_id_imm' AND NOT tgisinternal`,
    );
    expect(result.rowCount).toBe(1);
  });

  it('lets a tenant owner still read their own audit rows', async () => {
    const count = await asUser(USER_A, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.action_logs WHERE correlation_id = 'corr-audit-immut-001'`,
      );
      return Number(r.rows[0]?.n ?? '0');
    });
    expect(count).toBe(1);
  });

  it('denies a member relabelling an audit row to another tenant', async () => {
    await asUser(USER_A, async (c) => {
      await expect(
        c.query(`UPDATE public.action_logs SET business_id = '${BIZ_B}' WHERE correlation_id = 'corr-audit-immut-001'`),
      ).rejects.toThrow(/permission denied/i); // Production action API owns all writes (0021).
    });
    const after = await client.query<{ business_id: string }>(
      `SELECT business_id FROM public.action_logs WHERE correlation_id = 'corr-audit-immut-001'`,
    );
    expect(after.rows[0]?.business_id).toBe(BIZ_A);
  });

  it('denies a member rewriting audit content', async () => {
    await asUser(USER_A, async (c) => {
      await expect(c.query(
        `UPDATE public.action_logs SET reason = 'tampered' WHERE correlation_id = 'corr-audit-immut-001'`,
      )).rejects.toThrow(/permission denied/i);
    });
    const after = await client.query<{ reason: string | null }>(
      `SELECT reason FROM public.action_logs WHERE correlation_id = 'corr-audit-immut-001'`,
    );
    expect(after.rows[0]?.reason ?? null).toBeNull();
  });

  it('denies a member deleting an audit row', async () => {
    await asUser(USER_A, async (c) => {
      await expect(c.query(`DELETE FROM public.action_logs WHERE correlation_id = 'corr-audit-immut-001'`))
        .rejects.toThrow(/permission denied/i);
    });
    const after = await client.query(
      `SELECT 1 FROM public.action_logs WHERE correlation_id = 'corr-audit-immut-001'`,
    );
    expect(after.rowCount).toBe(1);
  });

  it('denies inserting an audit row that claims another tenant', async () => {
    await expect(
      asUser(USER_A, (c) =>
        c.query(
          `INSERT INTO public.action_logs (action_id, business_id, outcome, from_status, to_status,
                                           actor_id, actor_role, parameters_hash, correlation_id)
           VALUES ('${ACTION_A}', '${BIZ_B}', 'allowed', 'proposed', 'approved',
                   '${USER_A}', 'owner', 'hash-x', 'corr-audit-forged-001')`,
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    const forged = await client.query(
      `SELECT 1 FROM public.action_logs WHERE correlation_id = 'corr-audit-forged-001'`,
    );
    expect(forged.rowCount).toBe(0);
  });

  it('hides another tenant audit rows from SELECT', async () => {
    const visible = await asUser(USER_B, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.action_logs WHERE correlation_id = 'corr-audit-immut-001'`,
      );
      return Number(r.rows[0]?.n ?? '0');
    });
    expect(visible).toBe(0);
  });
});

describeDb('match_document_embeddings search_path (migration 0012)', () => {
  it('is pinned to an empty search_path', async () => {
    const result = await client.query<{ proconfig: string[] | null }>(
      `SELECT proconfig FROM pg_proc WHERE proname = 'match_document_embeddings'`,
    );
    expect(result.rows[0]?.proconfig).toEqual(['search_path=""']);
  });

  it('still executes with the schema-qualified operator', async () => {
    // Must not raise. Returning zero rows is fine; a missing operator or an
    // unpinned search_path would raise instead.
    await expect(
      client.query(
        `SELECT count(*) FROM public.match_document_embeddings(
           $1::uuid,
           (SELECT embedding FROM public.document_embeddings WHERE embedding IS NOT NULL LIMIT 1),
           5, 0.35, NULL)`,
        [BIZ_A],
      ),
    ).resolves.toBeDefined();
  });
});
