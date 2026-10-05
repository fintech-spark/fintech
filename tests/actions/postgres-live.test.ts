import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import '@/lib/database/postgres-client'; // Use the production pg numeric parsers.
import { createEventBus } from '@/lib/events';
import { asBusinessId, asUserId, type TenantContext } from '@/lib/types';
import type { DatabaseTransaction, TenantDatabaseClient } from '@/lib/database';
import { PostgresActionRepository, PostgresActionService, buildAuditEntry, createPostgresInternalActionCapabilities, createProductionActionExecutorRegistry, hashActionParameters, type Action } from '@/modules/actions';
import { PostgresAnalyticsRepository, PostgresAnalyticsService } from '@/modules/analytics';

// Explicit opt-in, local Docker credentials captured in memory and never logged.
// Everything, including the exact migration, is rolled back on this connection.
const live = process.env.LOCAL_DATABASE_URL || process.env.ACTION_LOCAL_DB_TESTS === '1' ? describe : describe.skip;
live('real local PostgreSQL action execution (rollback-only)', () => {
  let client: pg.Client;
  let db: TenantDatabaseClient;
  let service: PostgresActionService;
  const tenant = asBusinessId(randomUUID()); const otherTenant = asBusinessId(randomUUID());
  const ownerId = asUserId(randomUUID()); const proposerId = asUserId(randomUUID());
  const productId = randomUUID(); const otherProductId = randomUUID();
  const supplierId = randomUUID(); const otherSupplierId = randomUUID();
  const actor: TenantContext = { businessId: tenant, userId: ownerId, role: 'owner', correlationId: 'synthetic-live-action' };
  const proposer: TenantContext = { ...actor, userId: proposerId, role: 'manager' };
  const time = new Date();
  let transactionTail = Promise.resolve();
  let queryTail = Promise.resolve();
  function query(sql: string, params?: readonly unknown[]) {
    const result = queryTail.then(() => client.query(sql, params === undefined ? undefined : [...params]));
    queryTail = result.then(() => {}, () => {});
    return result;
  }

  beforeAll(async () => {
    const connectionString = process.env.LOCAL_DATABASE_URL;
    const password = connectionString ? undefined : execFileSync('docker', ['exec', 'supabase_db_merchant-brain', 'printenv', 'POSTGRES_PASSWORD'], { encoding: 'utf8' }).trim();
    client = new pg.Client(connectionString ? { connectionString } : { host: '127.0.0.1', port: 54322, user: 'postgres', password, database: 'postgres' });
    await client.connect(); await client.query('BEGIN');
    await client.query(await readFile(new URL('../../supabase/migrations/20261005000021_action_production.sql', import.meta.url), 'utf8'));
    db = {
      businessId: tenant,
      query: async <T>(sql: string, params?: readonly unknown[]) => (await query(sql, params)).rows as T[],
      execute: async (sql, params) => (await query(sql, params)).rowCount ?? 0,
      transaction: async <T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T> => {
        const previous = transactionTail;
        let unlock!: () => void;
        transactionTail = new Promise<void>((resolve) => { unlock = resolve; });
        await previous;
        const savepoint = `s${randomUUID().replaceAll('-', '')}`;
        await query(`SAVEPOINT ${savepoint}`);
        try {
          const result = await fn({ id: savepoint, query: db.query, execute: db.execute, commit: async () => {}, rollback: async () => {} });
          await query(`RELEASE SAVEPOINT ${savepoint}`); return result;
        } catch (error) { await query(`ROLLBACK TO SAVEPOINT ${savepoint}`); throw error; }
        finally { unlock(); }
      },
    };
    await client.query('INSERT INTO businesses (id, name, type) VALUES ($1, $3, $4), ($2, $3, $4)', [tenant, otherTenant, 'Synthetic action test', 'retail']);
    await client.query('INSERT INTO users (id, email, name) VALUES ($1, $3, $5), ($2, $4, $5)', [ownerId, proposerId, `${ownerId}@example.invalid`, `${proposerId}@example.invalid`, 'Synthetic action actor']);
    await client.query('INSERT INTO business_members (business_id, user_id, role, status) VALUES ($1, $2, $4, $6), ($1, $3, $5, $6)', [tenant, ownerId, proposerId, 'owner', 'manager', 'active']);
    await client.query('INSERT INTO products (id, business_id, name, unit, cost_price_minor, selling_price_minor) VALUES ($1,$3,$5,$6,100,200),($2,$4,$5,$6,100,200)', [productId, otherProductId, tenant, otherTenant, 'Synthetic product', 'piece']);
    await client.query('INSERT INTO suppliers (id, business_id, name) VALUES ($1,$3,$5),($2,$4,$5)', [supplierId, otherSupplierId, tenant, otherTenant, 'Synthetic supplier']);
    const analytics = new PostgresAnalyticsService(new PostgresAnalyticsRepository(db), { now: () => time });
    const capabilities = createPostgresInternalActionCapabilities(db, async (ctx, period) => ({ ...await analytics.getSnapshot(ctx, period) }));
    service = new PostgresActionService(new PostgresActionRepository(db), createProductionActionExecutorRegistry(capabilities), { now: () => time }, createEventBus());
  }, 20000);
  afterAll(async () => { if (client !== undefined) { await client.query('ROLLBACK'); await client.end(); } });

  async function approved(type: Action['type'], parameters: Action['parameters']) {
    const action = await service.propose(proposer, { type, parameters, title: 'Synthetic live action', description: '', source: 'manual' });
    await service.draft(proposer, action.id); await service.requestApproval(proposer, action.id); return service.approve(actor, action.id);
  }
  it('changes an actual product price, persists outcome and blocks concurrent/replayed execution', async () => {
    const action = await approved('adjust_price', { productId, newPriceMinor: 321 });
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => service.execute(actor, { id: action.id, idempotencyKey: 'live-price-key' })));
    expect(outcomes.filter((result) => result.executed)).toHaveLength(1);
    expect((await client.query('SELECT selling_price_minor FROM products WHERE business_id = $1 AND id = $2', [tenant, productId])).rows[0].selling_price_minor).toBe(321);
    expect(await service.getById(actor, action.id)).toMatchObject({ status: 'completed', result: { success: true, executorId: 'internal:adjust-price:v1' } });
    expect((await service.execute(actor, { id: action.id })).executed).toBe(false);
  });
  it('binds execution keys across different actions', async () => {
    const action = await approved('adjust_price', { productId, newPriceMinor: 999 });
    expect((await service.execute(actor, { id: action.id, idempotencyKey: 'live-price-key' })).denialReason).toBe('idempotency_conflict');
    expect((await service.getById(actor, action.id))?.status).toBe('approved');
  });
  it('changes a real supplier but refuses a cross-tenant supplier/product', async () => {
    const action = await approved('change_supplier', { productId, supplierId });
    expect((await service.execute(actor, { id: action.id })).executed).toBe(true);
    expect((await client.query('SELECT supplier_id FROM products WHERE business_id = $1 AND id = $2', [tenant, productId])).rows[0].supplier_id).toBe(supplierId);
    const foreignSupplier = await approved('change_supplier', { productId, supplierId: otherSupplierId });
    expect((await service.execute(actor, { id: foreignSupplier.id })).executed).toBe(false);
    const foreignProduct = await approved('adjust_price', { productId: otherProductId, newPriceMinor: 1 });
    expect((await service.execute(actor, { id: foreignProduct.id })).executed).toBe(false);
  });
  it('generates and persists a report through the real deterministic analytics service', async () => {
    const analytics = new PostgresAnalyticsService(new PostgresAnalyticsRepository(db), { now: () => time });
    await analytics.getSnapshot(actor, { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-10-01T00:00:00.000Z') });
    const action = await approved('generate_report', { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
    expect((await service.execute(actor, { id: action.id })).executed).toBe(true);
    const result = await service.getById(actor, action.id);
    expect(result?.result?.data).toMatchObject({ businessId: tenant });
    expect(result?.result?.data?.revenue).toMatchObject({ amount: 0, currency: 'INR' });
  });
  it('denies direct authenticated PostgREST-style writes that bypass lifecycle checks', async () => {
    expect((await client.query("SELECT has_table_privilege('authenticated','public.actions','UPDATE') AS allowed")).rows[0].allowed).toBe(false);
    expect((await client.query("SELECT has_table_privilege('authenticated','public.actions','INSERT') AS allowed")).rows[0].allowed).toBe(false);
  });
  it('refuses a direct executor call with no durable execution claim', async () => {
    const action = await approved('adjust_price', { productId, newPriceMinor: 500 });
    const capabilities = createPostgresInternalActionCapabilities(db, async () => ({}));
    await expect(capabilities.adjustPrice(action, actor, productId, 500)).rejects.toThrow(/no live execution claim/);
  });
  it('binds a proposal replay to the same request and rejects changed content', async () => {
    const input = { type: 'adjust_price' as const, title: 'Synthetic idempotent proposal', description: '', source: 'manual' as const, parameters: { productId, newPriceMinor: 400 }, idempotencyKey: 'live-proposal-key' };
    const first = await service.propose(proposer, input);
    expect((await service.propose(proposer, input)).id).toBe(first.id);
    await expect(service.propose(proposer, { ...input, parameters: { productId, newPriceMinor: 401 } })).rejects.toThrow(/different request/);
  });
  it('rolls back a state transition when its audit insert fails', async () => {
    const action = await service.propose(proposer, { type: 'adjust_price', title: 'Synthetic rollback', description: '', source: 'manual', parameters: { productId, newPriceMinor: 500 } });
    const entry = buildAuditEntry({ id: randomUUID(), action, fromStatus: 'proposed', toStatus: 'drafted', outcome: 'allowed', actorId: randomUUID(), actorRole: 'owner', actorIsMachine: false, message: 'Synthetic audit FK failure', now: time, correlationId: 'synthetic-rollback' });
    const repository = new PostgresActionRepository(db);
    await expect(repository.persistTransition({ ...action, status: 'drafted' }, action, entry)).rejects.toThrow();
    expect((await repository.findById(tenant, action.id))?.status).toBe('proposed');
  });
  it('refuses changed parameters in the atomic execution claim itself', async () => {
    const action = await approved('adjust_price', { productId, newPriceMinor: 700 });
    await client.query('UPDATE actions SET parameters = $3::jsonb WHERE business_id = $1 AND id = $2', [tenant, action.id, JSON.stringify({ productId, newPriceMinor: 701 })]);
    const repository = new PostgresActionRepository(db);
    const audit = buildAuditEntry({ id: randomUUID(), action, fromStatus: 'approved', toStatus: 'executing', outcome: 'allowed', actorId: ownerId, actorRole: 'owner', actorIsMachine: false, message: 'Synthetic claim race', now: time, correlationId: 'synthetic-claim' });
    expect(await repository.claimForExecution(tenant, action.id, time, { action, actorId: ownerId, parametersHash: hashActionParameters(action), executionKey: 'live-tamper-key', audit })).toBe(false);
    expect((await repository.findById(tenant, action.id))?.status).toBe('approved');
  });
  it('rolls the actual product mutation back when the terminal audit cannot persist', async () => {
    const before = (await client.query('SELECT selling_price_minor FROM products WHERE business_id=$1 AND id=$2',[tenant,productId])).rows[0].selling_price_minor;
    const action = await approved('adjust_price', { productId, newPriceMinor: 987 });
    await client.query("CREATE FUNCTION pg_temp.reject_terminal_action_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.to_status = 'completed' THEN RAISE EXCEPTION 'synthetic terminal audit failure'; END IF; RETURN NEW; END $$");
    await client.query('CREATE TRIGGER synthetic_terminal_audit_failure BEFORE INSERT ON action_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_terminal_action_audit()');
    await expect(service.execute(actor, { id: action.id })).rejects.toThrow('synthetic terminal audit failure');
    await client.query('DROP TRIGGER synthetic_terminal_audit_failure ON action_logs');
    expect((await client.query('SELECT selling_price_minor FROM products WHERE business_id=$1 AND id=$2',[tenant,productId])).rows[0].selling_price_minor).toBe(before);
    expect((await service.getById(actor,action.id))?.status).toBe('executing');
  });
  it('rechecks the owner membership at the database claim boundary', async () => {
    const action = await approved('adjust_price', { productId, newPriceMinor: 800 });
    await client.query("UPDATE business_members SET status = 'removed' WHERE business_id = $1 AND user_id = $2", [tenant, ownerId]);
    expect((await service.execute(actor, { id: action.id })).denialReason).toBe('concurrent_claim');
    expect((await service.getById(actor, action.id))?.status).toBe('approved');
    await client.query("UPDATE business_members SET status = 'active' WHERE business_id = $1 AND user_id = $2", [tenant, ownerId]);
  });
});
