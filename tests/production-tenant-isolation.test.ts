import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDatabaseClient } from '@/lib/database';
import { asActionId, asBusinessId, asDocumentId, asUserId, type TenantContext } from '@/lib/types';
import { DatabaseError, ValidationError } from '@/lib/errors';
import { PostgresNotificationRepository, PostgresNotificationService } from '@/modules/notifications';
import { PostgresAnalyticsRepository } from '@/modules/analytics';
import { PostgresCashFlowRepository, PostgresCashFlowForecastStore } from '@/modules/cash-flow';
import { PostgresProfitLeakRepository } from '@/modules/profit-leaks';
import { PostgresScenarioRepository } from '@/modules/simulator';
import { PostgresActionRepository } from '@/modules/actions';
import { PgChunkStore } from '@/modules/rag';
import { createBusinessReadOnlyTools, type BrainResponse } from '@/modules/business-brain';
import { PgChatStore } from '@/modules/business-brain/infrastructure/chat-repository';
import { PgEvidenceSourceResolver } from '@/modules/evidence';
import { createToolRegistry } from '@/lib/ai/tools/registry';

const localUrl = process.env.LOCAL_DATABASE_URL;
const A = asBusinessId(randomUUID());
const B = asBusinessId(randomUUID());
const userA = asUserId(randomUUID());
const userPeer = asUserId(randomUUID());
const userB = asUserId(randomUUID());
const actionB = asActionId(randomUUID());
const docA = asDocumentId(randomUUID());
const docB = asDocumentId(randomUUID());
const leakB = randomUUID();
const scenarioB = randomUUID();
const forecastB = randomUUID();
const noteA = randomUUID();
const notePeer = randomUUID();
const noteB = randomUUID();
const period = { from: new Date('2026-01-01'), to: new Date('2026-02-01') };
const asOf = new Date('2026-01-20');
const ctx = (businessId: typeof A, userId: typeof userA): TenantContext =>
  ({ businessId, userId, role: 'owner', correlationId: 'synthetic-raw-pg-isolation' });

describe.skipIf(!localUrl)('adversarial repository isolation on BYPASSRLS raw PG', () => {
  let db: ReturnType<typeof createDatabaseClient>;
  let notifications: PostgresNotificationService;

  beforeAll(async () => {
    const url = new URL(localUrl!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !url.pathname.startsWith('/data_production_')) {
      throw new Error('Use a disposable loopback data_production_* database for isolation tests.');
    }
    db = createDatabaseClient({ connectionString: localUrl });
    const [role] = await db.query<{ bypass: boolean }>(
      'SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user',
    );
    expect(role?.bypass).toBe(true); // Deliberately exercise the production hazard.
    await db.transaction(async (tx) => {
      try {
      for (const id of [A, B]) await tx.execute(
        "INSERT INTO businesses (id, name, type) VALUES ($1, $2, 'retail')", [id, id],
      );
      for (const id of [userA, userPeer, userB]) await tx.execute(
        'INSERT INTO users (id, email, name) VALUES ($1::uuid, $2, $1::text)', [id, `${id}@example.invalid`],
      );
      for (const [business, user] of [[A, userA], [A, userPeer], [B, userB]]) await tx.execute(
        "INSERT INTO business_members (business_id, user_id, role, status) VALUES ($1,$2,'owner','active')",
        [business, user],
      );
      for (const [id, business, user] of [[noteA, A, userA], [notePeer, A, userPeer], [noteB, B, userB]]) {
        await tx.execute(
          "INSERT INTO notifications (id,business_id,user_id,type,title,message,severity) VALUES ($1,$2,$3,'system','Synthetic','Synthetic','info')",
          [id, business, user],
        );
      }
      await tx.execute(
        "INSERT INTO transactions (business_id,type,counterparty_type,counterparty_id,subtotal_minor,total_minor,transaction_date,status,created_by) VALUES ($1,'sale','customer','walk-in',555555,555555,$2,'completed',$3)",
        [B, asOf, userB],
      );
      await tx.execute(
        "INSERT INTO actions (id,business_id,type,title,description,source,status,created_by) VALUES ($1,$2,'send_reminder','Synthetic','Synthetic','manual','approved',$3)",
        [actionB, B, userB],
      );
      await tx.execute(
        "INSERT INTO action_logs (action_id,business_id,to_status,outcome,actor_role,parameters_hash,correlation_id,message) VALUES ($1,$2,'approved','allowed','owner','synthetic','synthetic','Tenant B only')",
        [actionB, B],
      );
      await tx.execute(
        "INSERT INTO profit_leaks (id,business_id,category,severity,title,description,impact_minor,impact_period,evidence) VALUES ($1,$2,'dead_inventory','high','Tenant B only','Synthetic',555555,'2026-01','[]')",
        [leakB, B],
      );
      await tx.execute("INSERT INTO scenarios (id,business_id,name,baseline,projected,comparison) VALUES ($1,$2,'Tenant B only','{}','{}','{}')", [scenarioB, B]);
      await tx.execute(
        'INSERT INTO cash_flow_forecasts (id,business_id,period_start,period_end,periods,starting_cash_minor,ending_cash_minor,risks) VALUES ($1,$2,$3,$4,\'[]\',0,0,\'[]\')',
        [forecastB, B, period.from, period.to],
      );
      for (const [id, business, user] of [[docA, A, userA], [docB, B, userB]]) {
        await tx.execute(
          "INSERT INTO documents (id,business_id,file_name,mime_type,file_size,storage_path,source_type,uploaded_by) VALUES ($1::uuid,$2,'synthetic.pdf','application/pdf',1,$1::text,'invoice',$3)",
          [id, business, user],
        );
      }
      } catch (error) {
        // Fixtures contain synthetic data only; preserve setup diagnostics before
        // the production transport sanitizes database errors for HTTP callers.
        throw new DatabaseError(`Synthetic fixture setup failed: ${String(error)}`);
      }
    });
    notifications = new PostgresNotificationService(new PostgresNotificationRepository(db.forTenant(A)));
  });

  afterAll(async () => {
    if (!db) return;
    // All IDs are fresh per run; cleanup can only affect this suite's synthetic rows.
    await db.transaction(async (tx) => {
      await tx.execute('DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE business_id = ANY($1::uuid[]))', [[A, B]]);
      for (const table of ['notifications', 'document_embeddings', 'documents', 'action_logs',
        'actions', 'profit_leaks', 'scenarios', 'cash_flow_forecasts', 'transactions', 'chat_sessions', 'business_members']) {
        await tx.execute(`DELETE FROM ${table} WHERE business_id = ANY($1::uuid[])`, [[A, B]]);
      }
      await tx.execute('DELETE FROM businesses WHERE id = ANY($1::uuid[])', [[A, B]]);
      await tx.execute('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userA, userPeer, userB]]);
    });
    await db.close();
  });

  it('lists and counts only the recipient, including another user in the SAME business', async () => {
    const result = await notifications.list(ctx(A, userA), { status: 'unread', type: 'system', limit: 1 });
    expect(result.items.map((row) => row.id)).toEqual([noteA]);
    expect(result.total).toBe(1);
    expect(result.hasMore).toBe(false);
    expect(await notifications.getUnreadCount(ctx(A, userA))).toBe(1);
    expect((await notifications.list(ctx(A, userPeer), {})).items.map((row) => row.id)).toEqual([notePeer]);
  });

  it('cannot mark a peer or another tenant notification read by guessing its ID', async () => {
    await notifications.markAsRead(ctx(A, userA), notePeer);
    await notifications.markAsRead(ctx(A, userA), noteB);
    expect(await db.query('SELECT status FROM notifications WHERE id = ANY($1::uuid[])', [[notePeer, noteB]]))
      .toEqual([{ status: 'unread' }, { status: 'unread' }]);
    await notifications.markAsRead(ctx(A, userA), noteA);
    expect(await notifications.getUnreadCount(ctx(A, userA))).toBe(0);
  });

  it('mark-all updates only the caller recipient and tenant', async () => {
    await db.execute("UPDATE notifications SET status = 'unread', read_at = NULL WHERE id = $1", [noteA]);
    await notifications.markAllAsRead(ctx(A, userA));
    expect(await notifications.getUnreadCount(ctx(A, userA))).toBe(0);
    expect(await notifications.getUnreadCount(ctx(A, userPeer))).toBe(1);
    expect(await notifications.getUnreadCount(ctx(B, userB))).toBe(1);
  });

  it('analytics and cash-flow exclude another tenant ledger, with positive controls', async () => {
    const analytics = new PostgresAnalyticsRepository(db.forTenant(A));
    const cashFlow = new PostgresCashFlowRepository(db.forTenant(A));
    expect((await analytics.getSaleTotals(A, period)).grossRevenueMinor).toBe(0);
    expect((await analytics.getSaleTotals(B, period)).grossRevenueMinor).toBe(555555);
    expect((await cashFlow.getOpeningCash(A, period.to)).cashMinor).toBe(0);
    expect((await cashFlow.getOpeningCash(B, period.to)).cashMinor).toBe(555555);
  });

  it.each(['business_overview', 'sales_summary', 'product_performance', 'transaction_search',
    'inventory_status', 'customer_context', 'supplier_context', 'expense_summary',
    'cash_flow_summary', 'profit_leak_findings', 'context_coverage'])(
    'Business Brain %s executes on raw PG without foreign records', async (name) => {
    const tools = createBusinessReadOnlyTools(db);
    expect(tools).toHaveLength(11);
    const registry = createToolRegistry({ tools, authorize: async () => undefined });
    const tool = tools.find((item) => item.name === name)!;
    const dated = { period: { periodStart: period.from.toISOString(), periodEnd: period.to.toISOString() } };
    const input = tool.inputSchema.safeParse(dated).success ? dated : {};
    const result = await registry.open(ctx(A, userA)).call(tool.name, input);
    const data = JSON.stringify(result.data);
    for (const foreign of [B, actionB, docB, leakB, scenarioB, forecastB, '555555']) {
      expect(data, tool.name).not.toContain(foreign);
    }
  });

  it('Business Brain sales has a positive control for the other tenant fixture', async () => {
    const registry = createToolRegistry({ tools: createBusinessReadOnlyTools(db), authorize: async () => undefined });
    const positive = await registry.open(ctx(B, userB)).call('sales_summary', {
      period: { periodStart: period.from.toISOString(), periodEnd: period.to.toISOString() },
    });
    expect(JSON.stringify(positive.data)).toContain('555555');
  });

  it('durable chat isolates both tenant and session owner on raw PG', async () => {
    const store = new PgChatStore(db.forTenant(A));
    const sessionId = randomUUID();
    const response: BrainResponse = { message: 'Synthetic answer', toolsUsed: [], evidence: [], confidence: 'low',
      metadata: { totalLatencyMs: 0, modelUsed: 'synthetic-test', tokensUsed: 0, ragContextUsed: false } };
    await store.appendTurn(ctx(A, userA), sessionId, 'Synthetic question', response);
    expect((await store.history(ctx(A, userA), sessionId)).messages).toHaveLength(2);
    expect((await store.history(ctx(A, userPeer), sessionId)).messages).toEqual([]);
    await expect(store.appendTurn(ctx(A, userPeer), sessionId, 'forged', response))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.history(ctx(B, userB), sessionId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await store.history(ctx(A, userA), sessionId)).messages).toHaveLength(2);
  });

  it('evidence resolution rechecks active membership and server-bound tenant/user source scope', async () => {
    const own = { id: 'synthetic-own', businessId: A, userId: userA, resourceId: A,
      kind: 'tool_fact' as const, content: 'Synthetic context', observedAt: asOf.toISOString(),
      origin: 'synthetic-test', confidence: 'high' as const };
    const foreign = { ...own, id: 'synthetic-foreign', businessId: B, userId: userB };
    const resolver = new PgEvidenceSourceResolver(db.forTenant(A), [own, foreign]);
    expect(await resolver.resolve(ctx(A, userA), [own.id, foreign.id])).toEqual([own]);
    expect(await resolver.resolve(ctx(A, userPeer), [own.id])).toEqual([]);
    await db.execute("UPDATE business_members SET status = 'removed' WHERE business_id = $1 AND user_id = $2", [A, userPeer]);
    await expect(resolver.resolve(ctx(A, userPeer), [own.id])).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('profit-leak lookup, page, totals and status mutation exclude a guessed foreign ID', async () => {
    const repository = new PostgresProfitLeakRepository(db.forTenant(A));
    expect(await repository.findById(A, leakB)).toBeNull();
    expect((await repository.list(A, { page: 1, limit: 10 })).total).toBe(0);
    expect((await repository.sumActiveImpact(A)).totalMinor).toBe(0);
    await expect(repository.updateStatus(A, leakB, 'resolved')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await repository.findById(B, leakB))?.status).toBe('active');
  });

  it('profit-leak upsert cannot overwrite a different tenant by colliding on its row ID', async () => {
    const repository = new PostgresProfitLeakRepository(db.forTenant(A));
    const original = await repository.findById(B, leakB);
    expect(original).not.toBeNull();
    // Allow an explicit not-found refusal or a no-op, but never a foreign write.
    try {
      await repository.save({ ...original!, businessId: A, title: 'Forged by tenant A' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await repository.findById(B, leakB))?.title).toBe(original!.title);
  });

  it('scenario and forecast reads exclude guessed foreign IDs', async () => {
    const scenarios = new PostgresScenarioRepository(db.forTenant(A));
    const forecasts = new PostgresCashFlowForecastStore(db.forTenant(A));
    expect(await scenarios.findById(A, scenarioB)).toBeNull();
    expect((await scenarios.list(A, { page: 1, limit: 10 })).total).toBe(0);
    expect(await forecasts.findById(A, forecastB)).toBeNull();
    expect(await forecasts.findLatest(A)).toBeNull();
    expect(await forecasts.findById(B, forecastB)).not.toBeNull();
  });

  it('action lookup, claim, approval, completion and audit reads exclude foreign IDs', async () => {
    const repository = new PostgresActionRepository(db.forTenant(A));
    expect(await repository.findById(A, actionB)).toBeNull();
    expect(await repository.claimForExecution(A, actionB, asOf)).toBe(false);
    expect(await repository.recordApproval(A, actionB, userA, asOf, 'synthetic-hash')).toBe(false);
    expect(await repository.completeExecution(A, actionB, 'completed', asOf)).toBe(false);
    expect(await repository.listAudit(A, actionB)).toEqual([]);
    expect((await repository.findById(B, actionB))?.status).toBe('approved');
  });

  it('raw PG cannot forge an action audit tenant independently of its parent', async () => {
    await expect(db.execute(
      "INSERT INTO action_logs (action_id,business_id,to_status,outcome,actor_role,parameters_hash,correlation_id,message) VALUES ($1,$2,'approved','allowed','owner','synthetic','synthetic','forged')",
      [actionB, A],
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it('data security migration is re-runnable and preserves forced RLS and action write revokes', async () => {
    const sql = readFileSync('supabase/migrations/20261005000023_data_security.sql', 'utf8');
    await db.transaction(async (tx) => { await tx.execute(sql); });
    const rows = await db.query<{ table_name: string; enabled: boolean; forced: boolean }>(
      `SELECT relname AS table_name, relrowsecurity AS enabled, relforcerowsecurity AS forced
       FROM pg_class WHERE oid = ANY(ARRAY['public.document_embeddings'::regclass,
         'public.action_logs'::regclass, 'public.notifications'::regclass]) ORDER BY relname`,
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.enabled && row.forced)).toBe(true);
    expect(await db.query(
      `SELECT has_table_privilege('authenticated', 'public.actions', 'UPDATE') AS action_write,
        has_table_privilege('authenticated', 'public.action_logs', 'INSERT') AS audit_write`,
    )).toEqual([{ action_write: false, audit_write: false }]);
  });

  it('RAG save cannot pair the caller tenant with another tenant document', async () => {
    const store = new PgChunkStore({ database: db });
    await expect(store.save(A, [{
      documentId: docB, content: 'forged', embedding: Array(1536).fill(0.1),
      metadata: { businessId: A, sourceId: docB, sourceType: 'document', chunkIndex: 0,
        totalChunks: 1, chunkerVersion: 'synthetic-test' },
    }])).rejects.toBeInstanceOf(ValidationError);
  });

  it('vector search and delete exclude another tenant with matching content/vector', async () => {
    const store = new PgChunkStore({ database: db });
    const vector = Array<number>(1536).fill(0.1);
    await store.save(B, [{ documentId: docB, content: 'Tenant B only', embedding: vector,
      metadata: { businessId: B, sourceId: docB, sourceType: 'document', chunkIndex: 0,
        totalChunks: 1, chunkerVersion: 'synthetic-test' } }]);
    expect(await store.search(A, { queryEmbedding: vector, limit: 10, minSimilarity: 0 })).toEqual([]);
    expect(await store.deleteByDocument(A, docB)).toBe(0);
    expect(await store.search(B, { queryEmbedding: vector, limit: 10, minSimilarity: 0 })).toHaveLength(1);
  });

  it('SECURITY DEFINER vector matching rechecks membership even for a forged business argument', async () => {
    const vector = `[${Array<number>(1536).fill(0.1).join(',')}]`;
    async function match(userId: typeof userA, businessId: typeof A) {
      return db.transaction(async (tx) => {
        await tx.execute('SET LOCAL ROLE authenticated');
        await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
        return tx.query('SELECT chunk_id FROM public.match_document_embeddings($1, $2::vector, 5, 0)',
          [businessId, vector]);
      });
    }
    expect(await match(userA, B)).toHaveLength(0);
    expect(await match(userB, B)).toHaveLength(1);
    expect(await db.query(
      "SELECT has_function_privilege('anon', 'public.match_document_embeddings(uuid,vector,integer,real,text[])', 'EXECUTE') AS anonymous_execute",
    )).toEqual([{ anonymous_execute: false }]);
  });
});
