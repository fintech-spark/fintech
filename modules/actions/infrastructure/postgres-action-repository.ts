import { NotFoundError } from '@/lib/errors';
import {
  asActionId,
  asBusinessId,
  asUserId,
  type ActionId,
  type BusinessId,
  type PaginatedResult,
  type UserId,
} from '@/lib/types';
import type {
  Action,
  ActionAuditEntry,
  ActionStatus,
  ActionType,
} from '../domain/types';
import { canonicalize } from '../domain/rules';
import type { ActionFilters, ActionRepository } from './repository';

/**
 * PostgreSQL persistence for the action lifecycle.
 *
 * Two design points carry the security weight:
 *
 *  1. `claimForExecution` is ONE conditional UPDATE.
 *     `WHERE business_id = $1 AND id = $2 AND status = 'approved'`
 *     The precondition lives inside the statement, so the database, not the
 *     application, decides the single winner. Concurrent requests therefore
 *     cannot both execute, and no read-then-write window exists to lose.
 *
 *  2. `recordApproval` is likewise conditional on `status = 'awaiting_approval'`,
 *     so a second approval cannot overwrite the first approver.
 */
export class PostgresActionRepository implements ActionRepository {
  constructor(private readonly db: {
    query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
    execute(sql: string, params?: readonly unknown[]): Promise<number>;
    transaction<T>(fn: (tx: ActionTransaction) => Promise<T>): Promise<T>;
  }) {}

  async findById(businessId: BusinessId, id: ActionId): Promise<Action | null> {
    const rows = await this.db.query<ActionSqlRow>(SELECT_BY_ID_SQL, [businessId, id]);
    return rows[0] === undefined ? null : toDomain(rows[0]);
  }

  /**
   * Inserts an action, or returns the existing one for a repeated idempotency key.
   *
   * The partial unique index `(business_id, idempotency_key) WHERE idempotency_key
   * IS NOT NULL` is the authority here. `ON CONFLICT` is not usable against a
   * partial index, so the insert is attempted and a unique violation is translated
   * into a read of the existing row. That keeps one key to one action per tenant.
   */
  async save(action: Action): Promise<Action> {
    try {
      await this.db.execute(INSERT_SQL, [
        action.id,
        action.businessId,
        action.type,
        action.title,
        action.description,
        action.status,
        action.source,
        JSON.stringify(action.parameters),
        action.result === undefined ? null : JSON.stringify(action.result),
        idempotencyKeyOf(action),
        action.createdBy,
        action.approvedBy ?? null,
        action.approvedAt ?? null,
        action.executedAt ?? null,
        action.currency,
        JSON.stringify({
          relatedLeakId: action.relatedLeakId ?? null,
          relatedRiskId: action.relatedRiskId ?? null,
        }),
        action.createdAt,
      ]);
      return action;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findById(action.businessId, action.id);
      if (existing !== null) return existing;
      const byKey = await this.db.query<ActionSqlRow>(SELECT_BY_KEY_SQL, [
        action.businessId,
        idempotencyKeyOf(action),
      ]);
      if (byKey[0] !== undefined) return toDomain(byKey[0]);
      throw error;
    }
  }

  async update(action: Action): Promise<Action> {
    const affected = await this.db.execute(UPDATE_SQL, [
      action.status,
      action.title,
      action.description,
      JSON.stringify(action.parameters),
      action.result === undefined ? null : JSON.stringify(action.result),
      action.executedAt ?? null,
      action.updatedAt,
      action.businessId,
      action.id,
    ]);
    if (affected === 0) throw new NotFoundError('Action', action.id);
    return action;
  }

  async list(businessId: BusinessId, filters: ActionFilters): Promise<PaginatedResult<Action>> {
    const rows = await this.db.query<ActionSqlRow>(SELECT_PAGE_SQL, [
      businessId,
      filters.type ?? null,
      filters.status ?? null,
      filters.source ?? null,
      filters.limit,
      (filters.page - 1) * filters.limit,
    ]);
    const total = await this.count(businessId, filters);
    return {
      items: rows.map(toDomain),
      total,
      page: filters.page,
      limit: filters.limit,
      hasMore: filters.page * filters.limit < total,
    };
  }

  async findPendingApproval(businessId: BusinessId): Promise<readonly Action[]> {
    const rows = await this.db.query<ActionSqlRow>(SELECT_PENDING_SQL, [businessId, PENDING_APPROVAL_LIMIT]);
    return rows.map(toDomain);
  }

  /**
   * Atomically claims an action for execution.
   *
   * Returns `true` for exactly one caller. A second concurrent call matches zero
   * rows because the status is no longer `approved`, and an already-completed
   * action likewise matches nothing. This is the guarantee that an action never
   * runs twice.
   */
  async claimForExecution(
    businessId: BusinessId,
    id: ActionId,
    now: Date,
  ): Promise<boolean> {
    const affected = await this.db.execute(CLAIM_SQL, [businessId, id, now]);
    return affected === 1;
  }

  async completeExecution(
    businessId: BusinessId,
    id: ActionId,
    status: Extract<ActionStatus, 'completed' | 'failed'>,
    now: Date,
  ): Promise<boolean> {
    const affected = await this.db.execute(COMPLETE_SQL, [status, businessId, id, now]);
    return affected === 1;
  }

  /**
   * Records approval, conditionally.
   *
   * Only an action still awaiting approval can be approved, so a replayed or
   * duplicated approval request matches zero rows and the original approver is
   * preserved.
   */
  async recordApproval(
    businessId: BusinessId,
    id: ActionId,
    approvedBy: UserId,
    approvedAt: Date,
    parametersHash: string,
  ): Promise<boolean> {
    const affected = await this.db.execute(RECORD_APPROVAL_SQL, [
      businessId,
      id,
      approvedBy,
      approvedAt,
      approvedAt,
      JSON.stringify({ parametersHash }),
    ]);
    return affected === 1;
  }

  async appendAudit(entry: ActionAuditEntry): Promise<void> {
    await this.db.execute(INSERT_AUDIT_SQL, [
      entry.id,
      entry.actionId,
      entry.businessId,
      entry.fromStatus,
      entry.toStatus,
      entry.outcome,
      entry.actorId,
      entry.actorRole,
      entry.actorIsMachine,
      entry.reason ?? null,
      entry.message.slice(0, 1_000),
      entry.parametersHash,
      entry.executorId ?? null,
      entry.idempotencyKey ?? null,
      entry.correlationId,
      entry.createdAt,
    ]);
  }

  async listAudit(businessId: BusinessId, actionId: ActionId): Promise<readonly ActionAuditEntry[]> {
    const rows = await this.db.query<ActionAuditSqlRow>(SELECT_AUDIT_SQL, [businessId, actionId, AUDIT_TRAIL_LIMIT]);
    return rows.map((row) => ({
      id: row.id,
      actionId: asActionId(row.action_id),
      businessId: asBusinessId(row.business_id),
      fromStatus: row.from_status as ActionStatus | null,
      toStatus: row.to_status as ActionStatus,
      outcome: row.outcome as ActionAuditEntry['outcome'],
      actorId: row.actor_id === null ? null : (row.actor_id as UserId),
      actorRole: row.actor_role,
      actorIsMachine: row.actor_is_machine,
      ...(row.reason === null ? {} : { reason: row.reason as ActionAuditEntry['reason'] }),
      message: row.message ?? '',
      ...(row.idempotency_key === null ? {} : { idempotencyKey: row.idempotency_key }),
      parametersHash: row.parameters_hash,
      ...(row.executor_id === null ? {} : { executorId: row.executor_id }),
      createdAt: row.created_at,
      correlationId: row.correlation_id,
    }));
  }

  async getApprovalHash(businessId: BusinessId, actionId: ActionId): Promise<string | undefined> {
    const rows = await this.db.query<{ parameters_hash: string | null }>(
      APPROVAL_HASH_SQL,
      [businessId, actionId],
    );
    return rows[0]?.parameters_hash ?? undefined;
  }

  async isIdempotencyKeyBoundElsewhere(
    businessId: BusinessId,
    key: string,
    actionId: ActionId,
  ): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(IDEMPOTENCY_OWNER_SQL, [businessId, key]);
    const bound = rows[0]?.id;
    return bound !== undefined && bound !== actionId;
  }

  private async count(businessId: BusinessId, filters: ActionFilters): Promise<number> {
    const rows = await this.db.query<{ total: number }>(COUNT_SQL, [
      businessId,
      filters.type ?? null,
      filters.status ?? null,
      filters.source ?? null,
    ]);
    return rows[0]?.total ?? 0;
  }
}

/** Minimal transaction surface this repository needs. */
export interface ActionTransaction {
  query<T>(sql: string, params?: readonly unknown[]): Promise<readonly T[]>;
  execute(sql: string, params?: readonly unknown[]): Promise<number>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Appends an audit entry inside the same transaction as a state change.
 *
 * A state transition and its audit record must both land or neither must; a state
 * change without a trail entry is exactly the failure an audit trail exists to
 * prevent.
 */
export async function appendAuditInTransaction(
  tx: ActionTransaction,
  entry: ActionAuditEntry,
): Promise<void> {
  await tx.execute(INSERT_AUDIT_SQL, [
    entry.id,
    entry.actionId,
    entry.businessId,
    entry.fromStatus,
    entry.toStatus,
    entry.outcome,
    entry.actorId,
    entry.actorRole,
    entry.actorIsMachine,
    entry.reason ?? null,
    entry.message.slice(0, 1_000),
    entry.parametersHash,
    entry.executorId ?? null,
    entry.idempotencyKey ?? null,
    entry.correlationId,
    entry.createdAt,
  ]);
}

function idempotencyKeyOf(action: Action): string | null {
  const key = (action.parameters as { idempotencyKey?: unknown }).idempotencyKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505'
  );
}

interface ActionSqlRow {
  readonly id: string;
  readonly business_id: string;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly source: string;
  readonly parameters: unknown;
  readonly result: unknown;
  readonly idempotency_key: string | null;
  readonly created_by: string;
  readonly approved_by: string | null;
  readonly approved_at: Date | null;
  readonly executed_at: Date | null;
  readonly currency: string;
  readonly detail: unknown;
  readonly created_at: Date;
  readonly updated_at: Date;
}

interface ActionAuditSqlRow {
  readonly id: string;
  readonly action_id: string;
  readonly business_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly outcome: string;
  readonly actor_id: string | null;
  readonly actor_role: string;
  readonly actor_is_machine: boolean;
  readonly reason: string | null;
  readonly message: string | null;
  readonly parameters_hash: string;
  readonly executor_id: string | null;
  readonly idempotency_key: string | null;
  readonly correlation_id: string;
  readonly created_at: Date;
}

function toDomain(row: ActionSqlRow): Action {
  const detail = asDetail(row.detail);
  return {
    id: asActionId(row.id),
    businessId: asBusinessId(row.business_id),
    type: row.type as ActionType,
    title: row.title,
    description: row.description,
    status: row.status as Action['status'],
    source: row.source as Action['source'],
    parameters: asParameters(row.parameters),
    ...(row.result === null || row.result === undefined ? {} : { result: row.result as Action['result'] }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: asUserId(row.created_by),
    ...(row.approved_by === null ? {} : { approvedBy: asUserId(row.approved_by) }),
    ...(row.approved_at === null ? {} : { approvedAt: row.approved_at }),
    ...(row.executed_at === null ? {} : { executedAt: row.executed_at }),
    currency: row.currency,
    ...(detail.relatedLeakId === null ? {} : { relatedLeakId: detail.relatedLeakId }),
    ...(detail.relatedRiskId === null ? {} : { relatedRiskId: detail.relatedRiskId }),
  };
}

function asParameters(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    safe[key] = entry;
  }
  return safe;
}

function asDetail(value: unknown): { relatedLeakId: string | null; relatedRiskId: string | null } {
  const record =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    relatedLeakId: typeof record.relatedLeakId === 'string' ? record.relatedLeakId : null,
    relatedRiskId: typeof record.relatedRiskId === 'string' ? record.relatedRiskId : null,
  };
}

/** Bound on a single approval-queue read. */
export const PENDING_APPROVAL_LIMIT = 100;

const SELECT_COLUMNS = `
  id, business_id, type, title, description, status, source, parameters, result,
  idempotency_key, created_by, approved_by, approved_at, executed_at, currency,
  detail, created_at, updated_at
`;

const SELECT_BY_ID_SQL = `SELECT ${SELECT_COLUMNS} FROM actions WHERE business_id = $1 AND id = $2 LIMIT 1`;

const SELECT_BY_KEY_SQL = `
SELECT ${SELECT_COLUMNS}
FROM actions
WHERE business_id = $1 AND idempotency_key = $2
LIMIT 1
`;

const INSERT_SQL = `
INSERT INTO actions (
  id, business_id, type, title, description, status, source, parameters, result,
  idempotency_key, created_by, approved_by, approved_at, executed_at, currency, detail, created_at
)
VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, $15, $16::jsonb, $17
)
`;

const UPDATE_SQL = `
UPDATE actions
SET status = $1,
    title = $2,
    description = $3,
    parameters = $4::jsonb,
    result = $5::jsonb,
    executed_at = $6,
    updated_at = $7
WHERE business_id = $8 AND id = $9
`;

const SELECT_PAGE_SQL = `
SELECT ${SELECT_COLUMNS}
FROM actions
WHERE business_id = $1
  AND ($2::text IS NULL OR type = $2)
  AND ($3::text IS NULL OR status = $3)
  AND ($4::text IS NULL OR source = $4)
ORDER BY created_at DESC, id ASC
LIMIT $5 OFFSET $6
`;

const SELECT_PENDING_SQL = `
SELECT ${SELECT_COLUMNS}
FROM actions
WHERE business_id = $1 AND status = 'awaiting_approval'
ORDER BY created_at ASC, id ASC
LIMIT $2
`;

const COUNT_SQL = `
SELECT COUNT(*)::int AS total
FROM actions
WHERE business_id = $1
  AND ($2::text IS NULL OR type = $2)
  AND ($3::text IS NULL OR status = $3)
  AND ($4::text IS NULL OR source = $4)
`;

/**
 * The single-winner claim. `status = 'approved'` in the WHERE clause is the whole
 * concurrency control: the first UPDATE flips the status, so every other
 * concurrent or later call matches zero rows.
 */
const CLAIM_SQL = `
UPDATE actions
SET status = 'executing', updated_at = $3
WHERE business_id = $1 AND id = $2 AND status = 'approved'
`;

const COMPLETE_SQL = `
UPDATE actions
SET status = $1, updated_at = $4
WHERE business_id = $2 AND id = $3 AND status = 'executing'
`;

/**
 * Conditional approval. A duplicate or replayed approval matches zero rows, so the
 * original approver and timestamp are preserved and the caller learns the
 * transition did not happen.
 */
const RECORD_APPROVAL_SQL = `
UPDATE actions
SET status = 'approved',
    approved_by = $3,
    approved_at = $4,
    updated_at = $5,
    detail = COALESCE(detail, '{}'::jsonb) || $6::jsonb
WHERE business_id = $1 AND id = $2 AND status = 'awaiting_approval'
`;

const INSERT_AUDIT_SQL = `
INSERT INTO action_logs (
  id, action_id, business_id, from_status, to_status, outcome, actor_id, actor_role,
  actor_is_machine, reason, message, parameters_hash, executor_id, idempotency_key,
  correlation_id, created_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
`;

const SELECT_AUDIT_SQL = `
SELECT id, action_id, business_id, from_status, to_status, outcome, actor_id, actor_role,
       actor_is_machine, reason, message, parameters_hash, executor_id, idempotency_key,
       correlation_id, created_at
FROM action_logs
WHERE business_id = $1 AND action_id = $2
ORDER BY created_at ASC, id ASC
LIMIT $3
`;

/** Bound on a single action's audit-trail read. */
export const AUDIT_TRAIL_LIMIT = 500;

const APPROVAL_HASH_SQL = `
SELECT detail->>'parametersHash' AS parameters_hash
FROM actions
WHERE business_id = $1 AND id = $2
LIMIT 1
`;

const IDEMPOTENCY_OWNER_SQL = `SELECT id FROM actions WHERE business_id = $1 AND idempotency_key = $2 LIMIT 1`;

/** Exported for the SQL-safety test suite. */
export const __testing = { canonicalize };