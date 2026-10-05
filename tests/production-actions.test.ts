import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '@/lib/events';
import { ActionExecutorRegistry, PostgresActionService, createProductionActionExecutorRegistry, hashActionParameters, validateActionParameters, type Action, type InternalActionCapabilities } from '@/modules/actions';
import { DurableActionRepository, context, now, productId, proposer, supplierId, otherBusinessId } from './actions/support';

function setup(timeout = 30_000) {
  const repository = new DurableActionRepository();
  const capabilities: InternalActionCapabilities = {
    generateReport: vi.fn(async () => ({ revenueMinor: 12300, currency: 'INR', quality: 'complete' })),
    adjustPrice: vi.fn(async () => productId),
    changeSupplier: vi.fn(async () => productId),
  };
  const registry = createProductionActionExecutorRegistry(capabilities);
  let time = now;
  const service = new PostgresActionService(repository, registry, { now: () => time }, createEventBus(), undefined, timeout);
  return { service, repository, capabilities, registry, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
async function approved(s: ReturnType<typeof setup>, type: Action['type'] = 'adjust_price', parameters: Action['parameters'] = { productId, newPriceMinor: 200 }) {
  const action = await s.service.propose(proposer, { type, title: 'Synthetic action', description: 'Synthetic fixture only', source: 'manual', parameters });
  await s.service.draft(proposer, action.id);
  await s.service.requestApproval(proposer, action.id);
  return s.service.approve(context(), action.id);
}

describe('production action executors and durable lifecycle', () => {
  it('explicitly registers only real internal capabilities and freezes', () => {
    const { registry } = setup();
    expect([...registry.types()]).toEqual(['generate_report', 'adjust_price', 'change_supplier']);
    expect(registry.has('send_reminder')).toBe(false);
    expect(registry.has('reorder_stock')).toBe(false);
    expect(() => registry.register({ executorId: 'late', handles: 'send_reminder', execute: async () => ({ success: true, output: 'fake' }) })).toThrow(/frozen/);
  });
  it.each(['adjust_price', 'change_supplier', 'generate_report'] as const)('persists the real %s outcome', async (type) => {
    const s = setup();
    const params = type === 'generate_report' ? { from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' } : type === 'change_supplier' ? { productId, supplierId } : { productId, newPriceMinor: 200 };
    const action = await approved(s, type, params);
    const result = await s.service.execute(context(), { id: action.id });
    expect(result.executed).toBe(true);
    expect(result.auditEntryId).toBeTruthy();
    expect(await s.service.getById(context(), action.id)).toMatchObject({ status: 'completed', result: result.action?.result, executedAt: now });
    if (type === 'generate_report') expect(result.action?.result?.data).toMatchObject({ revenueMinor: 12300 });
  });
  it('permits only one invocation across concurrent requests and replay', async () => {
    const s = setup(); const action = await approved(s);
    const results = await Promise.all(Array.from({ length: 8 }, () => s.service.execute(context(), { id: action.id, idempotencyKey: 'same-execution' })));
    expect(results.filter((result) => result.executed)).toHaveLength(1);
    expect(s.capabilities.adjustPrice).toHaveBeenCalledTimes(1);
    expect((await s.service.execute(context(), { id: action.id })).denialReason).toBe('already_executed');
  });
  it('rejects absent approval hash and tampering before claiming', async () => {
    const s = setup(); const action = await approved(s);
    s.repository.missingHash = true;
    expect((await s.service.execute(context(), { id: action.id })).denialReason).toBe('parameter_tampering');
    s.repository.missingHash = false;
    await s.repository.update({ ...action, parameters: { productId, newPriceMinor: 999 } });
    expect((await s.service.execute(context(), { id: action.id })).denialReason).toBe('parameter_tampering');
    expect(s.capabilities.adjustPrice).not.toHaveBeenCalled();
    expect(hashActionParameters(action)).toMatch(/^[a-f0-9]{64}$/);
  });
  it('preserves distinct approver and owner-only execution', async () => {
    const s = setup(); const action = await s.service.propose(proposer, { type: 'adjust_price', title: 'Synthetic', description: '', source: 'manual', parameters: { productId, newPriceMinor: 100 } });
    await s.service.draft(proposer, action.id); await s.service.requestApproval(proposer, action.id);
    await expect(s.service.approve(proposer, action.id)).rejects.toThrow(/second approver/);
    await s.service.approve(context(), action.id);
    expect((await s.service.execute(proposer, { id: action.id })).denialReason).toBe('insufficient_role');
    expect(s.capabilities.adjustPrice).not.toHaveBeenCalled();
  });
  it('requires fresh approval after expiry and blocks approval replay', async () => {
    const s = setup(); const action = await approved(s);
    await expect(s.service.approve(context(), action.id)).rejects.toThrow(/awaiting approval/);
    s.advance(900001);
    expect((await s.service.execute(context(), { id: action.id })).denialReason).toBe('approval_expired');
    expect((await s.service.expire(context(), action.id)).status).toBe('awaiting_approval');
    await s.service.approve(context(), action.id);
    expect((await s.service.execute(context(), { id: action.id })).executed).toBe(true);
  });
  it('persists timeout uncertainty and prevents retry of a potentially completed side effect', async () => {
    const s = setup(5); s.capabilities.adjustPrice = vi.fn(() => new Promise<string>(() => {}));
    const action = await approved(s);
    const result = await s.service.execute(context(), { id: action.id });
    expect(result.action?.result?.errorCode).toBe('EXECUTION_TIMEOUT');
    expect((await s.service.getById(context(), action.id))?.status).toBe('failed');
    await expect(s.service.draft(proposer, action.id)).rejects.toThrow(/cannot be retried/);
    expect((await s.service.execute(context(), { id: action.id })).executed).toBe(false);
  });
  it('fails closed on audit/storage failure and lost claims', async () => {
    const s = setup(); const action = await approved(s);
    s.repository.loseClaim = true;
    expect((await s.service.execute(context(), { id: action.id })).denialReason).toBe('concurrent_claim');
    expect(s.capabilities.adjustPrice).not.toHaveBeenCalled();
    s.repository.loseClaim = false; s.repository.loseCompletion = true;
    await expect(s.service.execute(context(), { id: action.id })).rejects.toThrow(/durably recorded/);
    expect((await s.service.getById(context(), action.id))?.status).toBe('executing');
  });
  it('rejects unknown parameters/type and cross tenant operations', async () => {
    const s = setup(); const action = await approved(s);
    for (const operation of [s.service.draft, s.service.requestApproval, s.service.approve, s.service.reject, s.service.cancel, s.service.expire, s.service.execute]) {
      const fn = operation.bind(s.service) as (ctx: ReturnType<typeof context>, value: string | { id: string }, reason?: string) => Promise<unknown>;
      await expect(fn(context('owner', undefined, otherBusinessId), operation === s.service.execute ? { id: action.id } : action.id, 'synthetic')).rejects.toThrow(/not found/);
    }
    expect(() => validateActionParameters({ type: 'unknown' as never, parameters: {} })).toThrow(/Unsupported/);
    expect(() => validateActionParameters({ type: 'toString' as never, parameters: {} })).toThrow(/Unsupported/);
    expect(() => validateActionParameters({ type: 'generate_report', parameters: { from: '2026-02-30T00:00:00Z', to: '2026-10-01T00:00:00Z' } })).toThrow(/timestamp/);
    expect(() => validateActionParameters({ type: 'adjust_price', parameters: { productId, newPriceMinor: 100, businessId: otherBusinessId } })).toThrow(/not declared/);
    expect(() => validateActionParameters({ type: 'generate_report', parameters: { from: 0, to: '2026-10-01T00:00:00Z' } })).toThrow(/timestamp/);
    expect(new ActionExecutorRegistry().size).toBe(0);
  });
});
