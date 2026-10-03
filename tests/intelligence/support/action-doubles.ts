// In-memory action and profit-leak repository doubles.
//
// Split from `doubles.ts` to keep both files inside the repository's 800-line
// ceiling. They enforce the same invariants as their PostgreSQL counterparts:
// reads are tenant-scoped, `claimForExecution` succeeds for exactly one caller, and
// one idempotency key maps to one action per tenant.

import type { ActionId, BusinessId, PaginatedResult, UserId } from '@/lib/types';
import type {
  Action,
  ActionAuditEntry,
  ActionRepository,
  ActionStatus,
} from '@/modules/actions';
import type { LeakFilterInput, ProfitLeak, ProfitLeakRepository } from '@/modules/profit-leaks';

// Action double — enforces the single-winner claim and idempotency
// ---------------------------------------------------------------------------

export class InMemoryActionRepository implements ActionRepository {
  private readonly actions = new Map<string, Action>();
  private readonly audit: ActionAuditEntry[] = [];
  private readonly keys = new Map<string, string>();

  async findById(businessId: BusinessId, id: ActionId): Promise<Action | null> {
    return this.actions.get(`${businessId}:${id}`) ?? null;
  }

  async save(action: Action): Promise<Action> {
    const key = (action.parameters as { idempotencyKey?: string }).idempotencyKey;
    const storageKey = `${action.businessId}:${action.id}`;
    if (this.actions.has(storageKey)) return this.actions.get(storageKey) as Action;
    if (typeof key === 'string' && key.length > 0) {
      const keyScope = `${action.businessId}:${key}`;
      const existingId = this.keys.get(keyScope);
      if (existingId !== undefined) {
        const existing = this.actions.get(`${action.businessId}:${existingId}`);
        if (existing) return existing;
      }
      this.keys.set(keyScope, action.id);
    }
    this.actions.set(storageKey, action);
    return action;
  }

  async update(action: Action): Promise<Action> {
    this.actions.set(`${action.businessId}:${action.id}`, action);
    return action;
  }

  async list(businessId: BusinessId, filters: Parameters<ActionRepository['list']>[1]) {
    const all = [...this.actions.values()].filter(
      (row) =>
        row.businessId === businessId &&
        (filters.type === undefined || row.type === filters.type) &&
        (filters.status === undefined || row.status === filters.status) &&
        (filters.source === undefined || row.source === filters.source),
    );
    const start = (filters.page - 1) * filters.limit;
    return {
      items: all.slice(start, start + filters.limit),
      total: all.length,
      page: filters.page,
      limit: filters.limit,
      hasMore: start + filters.limit < all.length,
    };
  }

  async findPendingApproval(businessId: BusinessId): Promise<readonly Action[]> {
    return [...this.actions.values()].filter(
      (row) => row.businessId === businessId && row.status === 'awaiting_approval',
    );
  }

  /**
   * Mirrors the conditional UPDATE: only a caller that finds the action in
   * `approved` wins, and the winner's write is what every later caller sees.
   */
  async claimForExecution(businessId: BusinessId, id: ActionId, now: Date): Promise<boolean> {
    const action = this.actions.get(`${businessId}:${id}`);
    if (!action || action.status !== 'approved') return false;
    this.actions.set(`${businessId}:${id}`, { ...action, status: 'executing', updatedAt: now });
    return true;
  }

  async completeExecution(
    businessId: BusinessId,
    id: ActionId,
    status: Extract<ActionStatus, 'completed' | 'failed'>,
    now: Date,
  ): Promise<boolean> {
    const action = this.actions.get(`${businessId}:${id}`);
    if (!action || action.status !== 'executing') return false;
    this.actions.set(`${businessId}:${id}`, { ...action, status, updatedAt: now });
    return true;
  }

  async appendAudit(entry: ActionAuditEntry): Promise<void> {
    this.audit.push(entry);
  }

  async listAudit(businessId: BusinessId, actionId: ActionId): Promise<readonly ActionAuditEntry[]> {
    return this.audit.filter(
      (entry) => entry.businessId === businessId && entry.actionId === actionId,
    );
  }

  async getApprovalHash(businessId: BusinessId, actionId: ActionId): Promise<string | undefined> {
    const entry = this.audit
      .filter((row) => row.businessId === businessId && row.actionId === actionId)
      .filter((row) => row.toStatus === 'approved')
      .at(-1);
    return entry?.parametersHash;
  }

  async isIdempotencyKeyBoundElsewhere(
    businessId: BusinessId,
    key: string,
    actionId: ActionId,
  ): Promise<boolean> {
    const bound = this.keys.get(`${businessId}:${key}`);
    return bound !== undefined && bound !== actionId;
  }

  async recordApproval(
    businessId: BusinessId,
    id: ActionId,
    approvedBy: UserId,
    approvedAt: Date,
    parametersHash: string,
  ): Promise<boolean> {
    const action = this.actions.get(`${businessId}:${id}`);
    if (!action || action.status !== 'awaiting_approval') return false;
    this.actions.set(`${businessId}:${id}`, {
      ...action,
      status: 'approved',
      approvedBy,
      approvedAt,
      updatedAt: approvedAt,
    });
    this.approvalHashes.set(`${businessId}:${id}`, parametersHash);
    return true;
  }

  private readonly approvalHashes = new Map<string, string>();
}

// ---------------------------------------------------------------------------
// Profit-leak double
// ---------------------------------------------------------------------------

export class InMemoryProfitLeakRepository implements ProfitLeakRepository {
  private readonly rows = new Map<string, ProfitLeak>();

  async findById(businessId: BusinessId, id: string): Promise<ProfitLeak | null> {
    return this.rows.get(`${businessId}:${id}`) ?? null;
  }

  async save(leak: ProfitLeak): Promise<ProfitLeak> {
    this.rows.set(`${leak.businessId}:${leak.id}`, leak);
    return leak;
  }

  async update(leak: ProfitLeak): Promise<ProfitLeak> {
    this.rows.set(`${leak.businessId}:${leak.id}`, leak);
    return leak;
  }

  async list(businessId: BusinessId, filters: LeakFilterInput): Promise<PaginatedResult<ProfitLeak>> {
    const all = [...this.rows.values()].filter(
      (row) =>
        row.businessId === businessId &&
        (filters.status === undefined || row.status === filters.status) &&
        (filters.category === undefined || row.category === filters.category) &&
        (filters.severity === undefined || row.severity === filters.severity),
    );
    const start = (filters.page - 1) * filters.limit;
    return {
      items: all.slice(start, start + filters.limit),
      total: all.length,
      page: filters.page,
      limit: filters.limit,
      hasMore: start + filters.limit < all.length,
    };
  }

  async findActiveByCategory(): Promise<readonly ProfitLeak[]> {
    return [];
  }

  async sumActiveImpact(businessId: BusinessId) {
    const all = [...this.rows.values()].filter(
      (row) => row.businessId === businessId && (row.status === 'active' || row.status === 'acknowledged'),
    );
    return {
      totalMinor: all.reduce((total, row) => total + row.impact.amount, 0),
      leakCount: all.length,
    };
  }
}
