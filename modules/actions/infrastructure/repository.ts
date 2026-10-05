import type { ActionId, BusinessId, PaginatedResult, UserId } from '@/lib/types';
import type {
  Action,
  ActionAuditEntry,
  ActionStatus,
  ActionType,
  ActionSource,
} from '../domain/types';

/** Filters accepted by the action list endpoint. */
export interface ActionFilters {
  readonly type?: ActionType;
  readonly status?: ActionStatus;
  readonly source?: ActionSource;
  readonly page: number;
  readonly limit: number;
}

/**
 * Persistence contract for actions.
 *
 * The critical method is `claimForExecution`. It is a single conditional UPDATE
 * that moves an action from `approved` to `executing` and reports how many rows
 * it touched. Because the precondition is part of the statement, two concurrent
 * execution requests produce exactly one winner at the database level rather than
 * relying on a read-then-write race in application code.
 */
export interface ActionRepository {
  findById(businessId: BusinessId, id: ActionId): Promise<Action | null>;

  /**
   * Insert an action, or return the existing one when the idempotency key is
   * already bound within this tenant. Never creates a second row for one key.
   */
  save(action: Action, audit?: ActionAuditEntry): Promise<Action>;

  /** Production CAS + audit transaction; legacy repository doubles may omit it. */
  persistTransition?(action: Action, expected: Action, entry: ActionAuditEntry): Promise<boolean>;

  update(action: Action): Promise<Action>;

  list(businessId: BusinessId, filters: ActionFilters): Promise<PaginatedResult<Action>>;

  findPendingApproval(businessId: BusinessId): Promise<readonly Action[]>;

  /**
   * Atomically move an action from `approved` to `executing`.
   * Returns `true` only for the single caller that won the claim.
   */
  claimForExecution(
    businessId: BusinessId,
    id: ActionId,
    now: Date,
    guard?: { readonly action: Action; readonly actorId: UserId; readonly parametersHash: string; readonly executionKey: string; readonly audit: ActionAuditEntry },
  ): Promise<boolean>;

  /** Terminal transition after execution, also conditional on current state. */
  completeExecution(
    businessId: BusinessId,
    id: ActionId,
    status: Extract<ActionStatus, 'completed' | 'failed'>,
    now: Date,
    result?: Action['result'],
  ): Promise<boolean>;

  /** Append an entry to the action's immutable trail. */
  appendAudit(entry: ActionAuditEntry): Promise<void>;

  /** The action's audit trail, oldest first, tenant-scoped. */
  listAudit(businessId: BusinessId, actionId: ActionId): Promise<readonly ActionAuditEntry[]>;

  /** The parameter hash recorded when the action was approved. */
  getApprovalHash(businessId: BusinessId, actionId: ActionId): Promise<string | undefined>;

  /** True when the key is already bound to a different action within this tenant. */
  isIdempotencyKeyBoundElsewhere(
    businessId: BusinessId,
    key: string,
    actionId: ActionId,
  ): Promise<boolean>;

  /** Transition an action to `approved` and record the approving actor. */
  recordApproval(
    businessId: BusinessId,
    id: ActionId,
    approvedBy: UserId,
    approvedAt: Date,
    parametersHash: string,
  ): Promise<boolean>;
}
