import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { createEventBus } from '@/lib/events';
import type { NextRouteContext } from '@/lib/http/handler';
import { PostgresActionService, createProductionActionExecutorRegistry, type Action } from '@/modules/actions';
import { businessId, otherBusinessId, context, DurableActionRepository, now, productId, proposer } from './support';

let service: PostgresActionService;
let actor = context();
let authenticated = true;
let currentTime = now;
const adjustPrice = vi.fn(async () => productId);
vi.mock('@/lib/http/wiring', () => ({ wireIntelligence: () => ({ actions: service }) }));
vi.mock('@/lib/http/auth-context', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/http/auth-context')>();
  return { ...original, resolveTenantContext: async (_request: Request, requested: string) => {
    if (!authenticated) throw new AuthenticationError('Sign in required.');
    if (requested !== actor.businessId) throw new AuthorizationError('No membership.');
    return { ctx: actor };
  } };
});

import { POST as propose } from '@/app/api/businesses/[businessId]/actions/propose/route';
import { GET as list } from '@/app/api/businesses/[businessId]/actions/route';
import { GET as get } from '@/app/api/businesses/[businessId]/actions/[id]/route';
import { POST as draft } from '@/app/api/businesses/[businessId]/actions/[id]/draft/route';
import { POST as submit } from '@/app/api/businesses/[businessId]/actions/[id]/submit/route';
import { POST as approve } from '@/app/api/businesses/[businessId]/actions/[id]/approve/route';
import { POST as reject } from '@/app/api/businesses/[businessId]/actions/[id]/reject/route';
import { POST as cancel } from '@/app/api/businesses/[businessId]/actions/[id]/cancel/route';
import { POST as expire } from '@/app/api/businesses/[businessId]/actions/[id]/expire/route';
import { POST as execute } from '@/app/api/businesses/[businessId]/actions/[id]/execute/route';
import { GET as status } from '@/app/api/businesses/[businessId]/actions/[id]/status/route';
import { GET as history } from '@/app/api/businesses/[businessId]/actions/[id]/history/route';

type Handler = (request: Request, route: NextRouteContext) => Promise<Response>;
const routes: readonly [string, string, Handler][] = [
  ['propose', 'POST', propose], ['list', 'GET', list], ['get', 'GET', get], ['draft', 'POST', draft],
  ['submit', 'POST', submit], ['approve', 'POST', approve], ['reject', 'POST', reject], ['cancel', 'POST', cancel],
  ['expire', 'POST', expire], ['execute', 'POST', execute], ['status', 'GET', status], ['history', 'GET', history],
];
function call(handler: Handler, id?: string, body?: unknown, tenant = actor.businessId, headers?: Record<string, string>, method = 'POST') {
  return handler(new Request(`http://localhost/api/businesses/${tenant}/actions/${id ?? ''}`, {
    method, headers: { origin: 'http://localhost', ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { params: Promise.resolve({ businessId: tenant, ...(id === undefined ? {} : { id }) }) });
}
async function proposed(type: Action['type'] = 'adjust_price', parameters: Action['parameters'] = { productId, newPriceMinor: 500 }) {
  return service.propose(proposer, { type, parameters, title: 'Synthetic fixture', description: '', source: 'manual' });
}
async function awaitingApproval() {
  const action = await proposed(); await service.draft(proposer, action.id); await service.requestApproval(proposer, action.id); return action;
}

beforeEach(() => {
  actor = context(); authenticated = true; currentTime = now; adjustPrice.mockClear();
  service = new PostgresActionService(new DurableActionRepository(), createProductionActionExecutorRegistry({
    adjustPrice, changeSupplier: async () => productId, generateReport: async () => ({ currency: 'INR', quality: 'insufficient_data' }),
  }), { now: () => currentTime }, createEventBus());
});

describe('complete action HTTP lifecycle', () => {
  it('proposes, drafts, submits, approves, executes and reads durable status/history', async () => {
    actor = proposer;
    const response = await call(propose, undefined, { type: 'adjust_price', title: 'Synthetic', description: '', parameters: { productId, newPriceMinor: 500 } });
    expect(response.status).toBe(201);
    const { data: action } = await response.json() as { data: Action };
    expect((await call(draft, action.id)).status).toBe(200);
    expect((await call(submit, action.id)).status).toBe(200);
    actor = context();
    expect((await call(approve, action.id)).status).toBe(200);
    expect((await call(execute, action.id, undefined, businessId, { 'idempotency-key': 'synthetic-run' })).status).toBe(200);
    const durable = await (await call(status, action.id, undefined, businessId, undefined, 'GET')).json();
    expect(durable.data).toMatchObject({ status: 'completed', result: { success: true, executorId: 'internal:adjust-price:v1' } });
    const audit = await (await call(history, action.id, undefined, businessId, undefined, 'GET')).json();
    expect(audit.data.at(-1)).toMatchObject({ toStatus: 'completed', parametersHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(adjustPrice).toHaveBeenCalledTimes(1);
  });
  it.each(routes)('%s rejects unauthenticated callers', async (_name, method, handler) => {
    const action = await proposed(); authenticated = false;
    expect((await call(handler, action.id, undefined, businessId, undefined, method)).status).toBe(401);
  });
  it.each(routes)('%s verifies business membership before touching a record', async (_name, method, handler) => {
    const action = await proposed();
    expect((await call(handler, action.id, undefined, otherBusinessId, undefined, method)).status).toBe(403);
    expect(adjustPrice).not.toHaveBeenCalled();
  });
  it.each(routes.filter(([name]) => !['propose', 'list'].includes(name)))('%s hides another tenant record even for an authorized member', async (_name, method, handler) => {
    const action = await proposed(); actor = context('owner', undefined, otherBusinessId);
    expect((await call(handler, action.id, method === 'POST' && (handler === reject || handler === cancel) ? { reason: 'Synthetic' } : undefined, otherBusinessId, undefined, method)).status).toBe(404);
  });
  it.each(routes.filter(([, method]) => method === 'POST'))('%s rejects cross-origin mutation', async (_name, method, handler) => {
    const action = await proposed();
    expect((await call(handler, action.id, undefined, businessId, { origin: 'https://untrusted.invalid' }, method)).status).toBe(401);
  });
  it.each([draft, submit, approve, execute, expire])('rejects state/tenant/approval fields in mutation payloads', async (handler) => {
    const action = await proposed();
    expect((await call(handler, action.id, { status: 'approved', approvedBy: actor.userId, businessId: otherBusinessId })).status).toBe(400);
  });
  it.each([draft, submit, approve, execute, expire, reject, cancel])('rejects unknown type overrides on every mutation route', async (handler) => {
    const action = await proposed();
    expect((await call(handler, action.id, { type: 'shell', reason: 'Synthetic' })).status).toBe(400);
  });
  it('blocks approval bypass and unknown types, including forged read filters', async () => {
    const action = await proposed();
    expect((await call(execute, action.id)).status).toBe(409);
    expect((await call(propose, undefined, { type: 'shell', title: 'Synthetic', description: '', parameters: {} })).status).toBe(400);
    expect((await call(propose, undefined, { type: 'adjust_price', title: 'Synthetic', description: '', parameters: { productId, newPriceMinor: 10 }, businessId: otherBusinessId })).status).toBe(400);
    const response = await list(new Request(`http://localhost/api/businesses/${businessId}/actions?type=sql`), { params: Promise.resolve({ businessId }) });
    expect(response.status).toBe(400);
    expect(adjustPrice).not.toHaveBeenCalled();
  });
  it('rejects duplicate approval/execution and binds owner execution', async () => {
    const action = await awaitingApproval();
    expect((await call(approve, action.id)).status).toBe(200);
    expect((await call(approve, action.id)).status).toBe(409);
    actor = context('admin'); expect((await call(execute, action.id)).status).toBe(403);
    actor = context();
    const responses = await Promise.all(Array.from({ length: 5 }, () => call(execute, action.id)));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await call(execute, action.id)).status).toBe(409);
    expect(adjustPrice).toHaveBeenCalledTimes(1);
  });
  it('supports reject/cancel and refuses replay', async () => {
    const action = await awaitingApproval();
    expect((await call(reject, action.id, { reason: 'Synthetic rejection' })).status).toBe(200);
    expect((await call(reject, action.id, { reason: 'Synthetic replay' })).status).toBe(409);
    expect((await call(execute, action.id)).status).toBe(409);
    const second = await proposed();
    expect((await call(cancel, second.id)).status).toBe(200);
    expect((await call(cancel, second.id)).status).toBe(409);
  });
  it('expires stale approvals without permitting execution or silent renewal', async () => {
    const action = await awaitingApproval(); await call(approve, action.id);
    expect((await call(expire, action.id)).status).toBe(409);
    currentTime = new Date(now.getTime() + 900001);
    expect((await call(execute, action.id)).status).toBe(409);
    expect((await call(expire, action.id)).status).toBe(200);
    expect((await call(expire, action.id)).status).toBe(409);
    expect((await call(execute, action.id)).status).toBe(409);
  });
  it('exposes unsupported delivery as a failure, never HTTP success', async () => {
    const action = await proposed('send_reminder', { customerId: productId, channel: 'whatsapp', body: 'Synthetic reminder' });
    await service.draft(proposer, action.id); await service.requestApproval(proposer, action.id); await service.approve(actor, action.id);
    const response = await call(execute, action.id);
    expect(response.status).toBe(422);
    expect((await response.json()).data).toMatchObject({ executed: false, denialReason: 'no_registered_executor' });
  });
});
