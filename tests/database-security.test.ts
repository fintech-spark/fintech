import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

// Database-level security fixtures + RLS boundary tests against LOCAL Supabase.
// RLS is exercised via SET ROLE authenticated + request.jwt.claim.sub, which is
// exactly what Supabase's PostgREST path enforces.

const LOCAL_DB =
  process.env.LOCAL_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const BIZ_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const BIZ_B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const USER_A = 'bbbbbbbb-0000-4000-8000-00000000000a';
const USER_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const USER_AB = 'bbbbbbbb-0000-4000-8000-00000000000c';
const USER_ADM = 'bbbbbbbb-0000-4000-8000-00000000000d';
const TX_A = 'dddddddd-0000-4000-8000-00000000000a';
const TX_B = 'dddddddd-0000-4000-8000-00000000000b';
const TX_ITEM_A = 'eeeeeeee-0000-4000-8000-00000000000a';
const TX_ITEM_B = 'eeeeeeee-0000-4000-8000-00000000000b';
const ACTION_A = 'ffffffff-0000-4000-8000-00000000000a';
const ACTION_B = 'ffffffff-0000-4000-8000-00000000000b';
const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';
const NOTIF_A_FOR_USER_B = '33333333-3333-4333-8333-333333333333';

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
       ('${BIZ_A}', 'Fixture Business A', 'retail', 'active'),
       ('${BIZ_B}', 'Fixture Business B', 'retail', 'active')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO users (id, email, name) VALUES
       ('${USER_A}', 'fixture.a@example.invalid', 'Fixture User A'),
       ('${USER_B}', 'fixture.b@example.invalid', 'Fixture User B'),
       ('${USER_AB}', 'fixture.ab@example.invalid', 'Fixture User AB'),
       ('${USER_ADM}', 'fixture.adm@example.invalid', 'Fixture Admin')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO business_members (business_id, user_id, role, status) VALUES
       ('${BIZ_A}', '${USER_A}', 'owner', 'active'),
       ('${BIZ_B}', '${USER_B}', 'owner', 'active'),
       ('${BIZ_A}', '${USER_AB}', 'staff', 'active'),
       ('${BIZ_B}', '${USER_AB}', 'staff', 'active'),
       ('${BIZ_A}', '${USER_ADM}', 'admin', 'active')
     ON CONFLICT (business_id, user_id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO transactions (id, business_id, type, counterparty_type, counterparty_id, subtotal_minor, total_minor, transaction_date, created_by) VALUES
       ('${TX_A}', '${BIZ_A}', 'sale', 'customer', 'walk-in', 1000, 1000, now(), '${USER_A}'),
       ('${TX_B}', '${BIZ_B}', 'sale', 'customer', 'walk-in', 2000, 2000, now(), '${USER_B}')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO transaction_items (id, transaction_id, product_name, quantity, unit_price_minor, total_minor) VALUES
       ('${TX_ITEM_A}', '${TX_A}', 'Fixture Item A', 1, 1000, 1000),
       ('${TX_ITEM_B}', '${TX_B}', 'Fixture Item B', 1, 2000, 2000)
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO actions (id, business_id, type, title, description, source, created_by) VALUES
       ('${ACTION_A}', '${BIZ_A}', 'custom', 'Fixture Action A', 'fixture', 'manual', '${USER_A}'),
       ('${ACTION_B}', '${BIZ_B}', 'custom', 'Fixture Action B', 'fixture', 'manual', '${USER_B}')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO action_logs (action_id, status, message) VALUES
       ('${ACTION_A}', 'proposed', 'fixture A'),
       ('${ACTION_B}', 'proposed', 'fixture B')`,
  );
  await client.query(
    `INSERT INTO chat_sessions (id, business_id, user_id) VALUES
       ('${SESSION_A}', '${BIZ_A}', '${USER_A}'),
       ('${SESSION_B}', '${BIZ_B}', '${USER_B}')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO chat_messages (session_id, role, content) VALUES
       ('${SESSION_A}', 'user', 'fixture message A'),
       ('${SESSION_B}', 'user', 'fixture message B')`,
  );
  await client.query(
    `INSERT INTO notifications (id, business_id, user_id, type, title, message, severity) VALUES
       ('${NOTIF_A_FOR_USER_B}', '${BIZ_A}', '${USER_B}', 'system', 't', 'm', 'info')
     ON CONFLICT (id) DO NOTHING`,
  );
});

afterAll(async () => {
  await client.query(`DELETE FROM notifications WHERE id = '${NOTIF_A_FOR_USER_B}'`);
  await client.query(`DELETE FROM chat_messages WHERE session_id IN ('${SESSION_A}','${SESSION_B}')`);
  await client.query(`DELETE FROM chat_sessions WHERE id IN ('${SESSION_A}','${SESSION_B}')`);
  await client.query(`DELETE FROM action_logs WHERE action_id IN ('${ACTION_A}','${ACTION_B}')`);
  await client.query(`DELETE FROM actions WHERE id IN ('${ACTION_A}','${ACTION_B}')`);
  await client.query(`DELETE FROM transaction_items WHERE id IN ('${TX_ITEM_A}','${TX_ITEM_B}')`);
  await client.query(`DELETE FROM transactions WHERE id IN ('${TX_A}','${TX_B}')`);
  await client.query(`DELETE FROM business_members WHERE business_id IN ('${BIZ_A}','${BIZ_B}')`);
  await client.query(`DELETE FROM users WHERE id IN ('${USER_A}','${USER_B}','${USER_AB}','${USER_ADM}')`);
  await client.query(`DELETE FROM businesses WHERE id IN ('${BIZ_A}','${BIZ_B}')`);
  await client.end();
});

describe('RLS - direct tenant tables', () => {
  it('denies cross-tenant SELECT', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM transactions WHERE id = '${TX_B}'`);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('denies cross-tenant INSERT (forged business_id)', async () => {
    await expect(
      asUser(USER_A, () =>
        client.query(
          `INSERT INTO transactions (business_id, type, counterparty_type, counterparty_id, subtotal_minor, total_minor, transaction_date, created_by)
           VALUES ('${BIZ_B}', 'sale', 'customer', 'x', 1, 1, now(), '${USER_A}')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('denies cross-tenant UPDATE', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`UPDATE transactions SET notes = 'x' WHERE id = '${TX_B}'`);
      expect(r.rowCount).toBe(0);
    });
  });

  it('denies cross-tenant DELETE', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`DELETE FROM transactions WHERE id = '${TX_B}'`);
      expect(r.rowCount).toBe(0);
    });
  });

  it('allows member to read and write own tenant rows', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM transactions WHERE id = '${TX_A}'`);
      expect(r.rows).toHaveLength(1);
    });
  });

  it('rejects ownership mutation (business_id escape) even for dual members', async () => {
    await expect(
      asUser(USER_AB, () =>
        client.query(`UPDATE transactions SET business_id = '${BIZ_B}' WHERE id = '${TX_A}'`),
      ),
    ).rejects.toThrow(/tenant boundary violation/i);
  });

  it('rejects unauthorized business_members insertion', async () => {
    // 0008 fires the escalation trigger before the RLS WITH CHECK on INSERT,
    // so a non-owner minting 'owner' is denied by the trigger, not the policy.
    await expect(
      asUser(USER_A, () =>
        client.query(
          `INSERT INTO business_members (business_id, user_id, role, status) VALUES ('${BIZ_B}', '${USER_A}', 'owner', 'active')`,
        ),
      ),
    ).rejects.toThrow(/row-level security|privilege escalation/i);
  });
});

describe('RLS - indirect/child tables', () => {
  it('denies cross-tenant SELECT on transaction_items', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM transaction_items WHERE id = '${TX_ITEM_B}'`);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('denies cross-tenant INSERT on transaction_items (forged parent)', async () => {
    await expect(
      asUser(USER_A, () =>
        client.query(
          `INSERT INTO transaction_items (transaction_id, product_name, quantity, unit_price_minor, total_minor)
           VALUES ('${TX_B}', 'evil', 1, 1, 1)`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('denies cross-tenant SELECT on action_logs', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM action_logs WHERE action_id = '${ACTION_B}'`);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('denies cross-tenant INSERT on action_logs', async () => {
    await expect(
      asUser(USER_A, () =>
        client.query(`INSERT INTO action_logs (action_id, status) VALUES ('${ACTION_B}', 'x')`),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('denies cross-tenant SELECT on chat_messages', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM chat_messages WHERE session_id = '${SESSION_B}'`);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('denies cross-tenant INSERT on chat_messages (forged session)', async () => {
    await expect(
      asUser(USER_A, () =>
        client.query(
          `INSERT INTO chat_messages (session_id, role, content) VALUES ('${SESSION_B}', 'user', 'x')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('scopes notifications to the recipient user', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM notifications WHERE id = '${NOTIF_A_FOR_USER_B}'`);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('scopes chat_sessions to the owning user', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM chat_sessions WHERE id = '${SESSION_B}'`);
      expect(r.rows).toHaveLength(0);
    });
  });
});

describe('RLS - users & businesses root tables', () => {
  it('hides other users profiles', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM users WHERE id = '${USER_B}'`);
      expect(r.rows).toHaveLength(0);
    });
  });

  it('hides other businesses from members', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(`SELECT id FROM businesses WHERE id = '${BIZ_B}'`);
      expect(r.rows).toHaveLength(0);
    });
  });
});

describe('RLS - audit hardening (0006/0008)', () => {
  it('denies audit_logs INSERT for members (append-only)', async () => {
    await expect(
      asUser(USER_A, () =>
        client.query(
          `INSERT INTO audit_logs (business_id, user_id, action, resource_type, resource_id)
           VALUES ('${BIZ_A}', '${USER_A}', 'view', 'transaction', 'x')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('denies audit_logs UPDATE/DELETE for members', async () => {
    await client.query(
      `INSERT INTO audit_logs (business_id, user_id, action, resource_type, resource_id)
       VALUES ('${BIZ_A}', '${USER_A}', 'view', 'transaction', 'fixture-append-only')
       ON CONFLICT DO NOTHING`,
    );
    await asUser(USER_A, async () => {
      const u = await client.query(
        `UPDATE audit_logs SET action = 'delete' WHERE resource_id = 'fixture-append-only' AND business_id = '${BIZ_A}'`,
      );
      expect(u.rowCount).toBe(0);
      const d = await client.query(
        `DELETE FROM audit_logs WHERE resource_id = 'fixture-append-only' AND business_id = '${BIZ_A}'`,
      );
      expect(d.rowCount).toBe(0);
    });
    await client.query(`DELETE FROM audit_logs WHERE resource_id = 'fixture-append-only'`);
  });

  it('blocks admin self-promotion to owner (UPDATE path)', async () => {
    await expect(
      asUser(USER_ADM, () =>
        client.query(
          `UPDATE business_members SET role = 'owner'
           WHERE business_id = '${BIZ_A}' AND user_id = '${USER_ADM}'`,
        ),
      ),
    ).rejects.toThrow(/privilege escalation/i);
  });

  it('blocks admin granting owner via INSERT (M3-002)', async () => {
    await expect(
      asUser(USER_ADM, () =>
        client.query(
          `INSERT INTO business_members (business_id, user_id, role, status)
           VALUES ('${BIZ_A}', '${USER_B}', 'owner', 'active')`,
        ),
      ),
    ).rejects.toThrow(/privilege escalation/i);
  });

  it('lets an admin add ordinary members (no over-blocking)', async () => {
    await asUser(USER_ADM, async () => {
      const ins = await client.query(
        `INSERT INTO business_members (business_id, user_id, role, status)
         VALUES ('${BIZ_A}', '${USER_B}', 'staff', 'active')`,
      );
      expect(ins.rowCount).toBe(1);
      const del = await client.query(
        `DELETE FROM business_members WHERE business_id = '${BIZ_A}' AND user_id = '${USER_B}'`,
      );
      expect(del.rowCount).toBe(1);
    });
  });

  it('lets an owner change roles (positive control)', async () => {
    await asUser(USER_A, async () => {
      const up = await client.query(
        `UPDATE business_members SET role = 'admin'
         WHERE business_id = '${BIZ_A}' AND user_id = '${USER_AB}'`,
      );
      expect(up.rowCount).toBe(1);
      const back = await client.query(
        `UPDATE business_members SET role = 'staff'
         WHERE business_id = '${BIZ_A}' AND user_id = '${USER_AB}'`,
      );
      expect(back.rowCount).toBe(1);
    });
  });

  it('denies staff self-promotion (no admin rights)', async () => {
    await asUser(USER_AB, async () => {
      const r = await client.query(
        `UPDATE business_members SET role = 'owner'
         WHERE business_id = '${BIZ_A}' AND user_id = '${USER_AB}'`,
      );
      expect(r.rowCount).toBe(0);
    });
  });

  it('blocks users.email mutation', async () => {
    await expect(
      asUser(USER_A, () =>
        client.query(`UPDATE users SET email = 'evil@example.invalid' WHERE id = '${USER_A}'`),
      ),
    ).rejects.toThrow(/immutable/i);
  });
});

describe('RPC / function boundaries', () => {
  it('auth_user_businesses() returns only the caller tenants', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query('SELECT * FROM public.auth_user_businesses()');
      expect(r.rows.map((x: { auth_user_businesses: string }) => x.auth_user_businesses)).toEqual([BIZ_A]);
    });
  });
});

describe('Storage isolation', () => {
  it('denies upload into another tenant folder', async () => {
    await expect(
      asUser(USER_A, () =>
        client.query(
          `INSERT INTO storage.objects (bucket_id, name) VALUES ('merchant-files', '${BIZ_B}/invoice.pdf')`,
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('allows upload into own tenant folder', async () => {
    await asUser(USER_A, async () => {
      const r = await client.query(
        `INSERT INTO storage.objects (bucket_id, name) VALUES ('merchant-files', '${BIZ_A}/invoice.pdf')`,
      );
      expect(r.rowCount).toBe(1);
    });
    await client.query('SET session_replication_role = replica');
    await client.query(`DELETE FROM storage.objects WHERE name = '${BIZ_A}/invoice.pdf'`);
    await client.query('RESET session_replication_role');
  });

  it('denies reading objects in another tenant folder', async () => {
    await client.query(
      `INSERT INTO storage.objects (bucket_id, name) VALUES ('merchant-files', '${BIZ_B}/secret.pdf') ON CONFLICT DO NOTHING`,
    );
    await asUser(USER_A, async () => {
      const r = await client.query(
        `SELECT id FROM storage.objects WHERE name = '${BIZ_B}/secret.pdf'`,
      );
      expect(r.rows).toHaveLength(0);
    });
    await client.query('SET session_replication_role = replica');
    await client.query(`DELETE FROM storage.objects WHERE name = '${BIZ_B}/secret.pdf'`);
    await client.query('RESET session_replication_role');
  });
});
