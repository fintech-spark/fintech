import { asBusinessId, asUserId, type TenantContext } from '@/lib/types';
import { canonicalize, type Action, type ActionAuditEntry } from '@/modules/actions';
import { InMemoryActionRepository } from '../intelligence/support/action-doubles';

export const businessId = asBusinessId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
export const otherBusinessId = asBusinessId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
export const productId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const supplierId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const now = new Date('2026-10-05T12:00:00.000Z');
export function context(role: TenantContext['role'] = 'owner', user = '11111111-1111-4111-8111-111111111111', tenant = businessId): TenantContext {
  return { businessId: tenant, userId: asUserId(user), role, correlationId: 'synthetic-action-request' };
}
export const proposer = context('manager', '22222222-2222-4222-8222-222222222222');

/** Synthetic CAS repository exercising the production service path. */
export class DurableActionRepository extends InMemoryActionRepository {
  auditFailure = false;
  missingHash = false;
  loseClaim = false;
  loseCompletion = false;
  override async save(action: Action, audit?: ActionAuditEntry): Promise<Action> {
    const saved = await super.save(action);
    if (audit !== undefined && saved.id === action.id) await this.appendAudit(audit);
    return saved;
  }
  async persistTransition(action: Action, expected: Action, entry: ActionAuditEntry): Promise<boolean> {
    const current = await this.findById(action.businessId, action.id);
    if (current?.status !== expected.status || canonicalize(current.parameters) !== canonicalize(expected.parameters) || this.loseCompletion && expected.status === 'executing') return false;
    if (this.auditFailure) throw new Error('synthetic audit failure');
    await this.appendAudit(entry);
    await this.update(action);
    return true;
  }
  override async getApprovalHash(...args: Parameters<InMemoryActionRepository['getApprovalHash']>) {
    return this.missingHash ? undefined : super.getApprovalHash(...args);
  }
  override async claimForExecution(...args: Parameters<InMemoryActionRepository['claimForExecution']>) {
    return this.loseClaim ? false : super.claimForExecution(...args);
  }
}
