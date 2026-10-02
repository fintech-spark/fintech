import type { ActionId, BusinessId, UserId } from '@/lib/types';

/**
 * Action lifecycle types.
 *
 * This module is the highest-security surface in the product: it is the only
 * place where a machine-proposed intent can become a real change to a merchant's
 * business. Four properties are enforced structurally, not by convention:
 *
 *  1. APPROVAL IS A SERVER-SIDE STATE, NOT A FLAG. An action reaches
 *     `approved` only through a transition guarded by role, tenant and
 *     segregation of duties. The model's opinion is never consulted.
 *  2. EXECUTION IS CLAIMED, NOT CHECKED-THEN-SET. `approved -> executing` is a
 *     conditional UPDATE that only succeeds once, so two concurrent requests
 *     cannot both execute.
 *  3. EXECUTORS ARE ALLOWLISTED BY TYPE. An unregistered action type fails
 *     closed. There is no dynamic dispatch, no `eval`, no reflection.
 *  4. PARAMETERS ARE TAMPER-EVIDENT. The parameter set is hashed at approval and
 *     re-verified at execution, so an edit between the two is detected.
 */

export type ActionType =
  | 'adjust_price'
  | 'reorder_stock'
  | 'send_reminder'
  | 'change_supplier'
  | 'reduce_expense'
  | 'create_transaction'
  | 'custom';

export type ActionStatus =
  | 'proposed'
  | 'drafted'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ActionSource = 'ai_recommendation' | 'profit_leak' | 'cash_flow_risk' | 'manual';

export interface ActionResult {
  readonly success: boolean;
  readonly output?: string;
  readonly error?: string;
  readonly errorCode?: string;
  readonly affectedResources?: readonly { readonly type: string; readonly id: string }[];
  /** Executor that handled the action. Recorded for audit. */
  readonly executorId?: string;
}

/** An action proposed or created for a business. */
export interface Action {
  readonly id: ActionId;
  readonly businessId: BusinessId;
  readonly type: ActionType;
  readonly title: string;
  readonly description: string;
  readonly status: ActionStatus;
  readonly source: ActionSource;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly result?: ActionResult;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly createdBy: UserId;
  readonly approvedBy?: UserId;
  readonly approvedAt?: Date;
  readonly executedAt?: Date;
  readonly currency: string;
  /** Present when the action was proposed in response to a specific finding. */
  readonly relatedLeakId?: string;
  readonly relatedRiskId?: string;
}

/**
 * The transition table.
 *
 * Preserved exactly as published. Note the deliberate asymmetry: `approved`
 * admits only `executing`, so there is no path from approval back to cancellation.
 * A merchant who wants to stop an approved action must let it fail or complete;
 * silently reversing an approved action would break the audit trail.
 */
export const ACTION_STATUS_TRANSITIONS: Record<ActionStatus, readonly ActionStatus[]> = {
  proposed: ['drafted', 'cancelled'],
  drafted: ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['approved', 'cancelled'],
  approved: ['executing'],
  executing: ['completed', 'failed'],
  completed: [],
  failed: ['drafted'],
  cancelled: [],
};

/**
 * Action types whose execution moves money, changes a financial record, or
 * communicates externally.
 *
 * These carry the two extra controls: a distinct approver, and an approval
 * freshness window. A low-risk internal action such as drafting a reorder
 * suggestion does not, because blocking a single-owner merchant from approving
 * their own stock reorder would be a product failure, not a security win.
 */
export const CONSEQUENTIAL_ACTION_TYPES: readonly ActionType[] = [
  'adjust_price',
  'send_reminder',
  'reduce_expense',
  'create_transaction',
];

/**
 * Types that may be executed without human approval at all.
 *
 * Intentionally narrow: only an action whose every effect is internal and
 * reversible, and which records nothing a merchant could be surprised by. An empty
 * list here would be safer still; these two are the cases where automation adds
 * value without adding risk.
 */
export const AUTO_EXECUTABLE_ACTION_TYPES: readonly ActionType[] = [];

/** Classification used by the approval policy. */
export type ActionRiskTier = 'low' | 'consequential' | 'prohibited';

export type ActionAuditOutcome = 'allowed' | 'denied';

export type ActionDenialReason =
  | 'not_authenticated'
  | 'insufficient_role'
  | 'cross_tenant'
  | 'invalid_state_transition'
  | 'approval_required'
  | 'approval_expired'
  | 'approval_replay'
  | 'self_approval_forbidden'
  | 'parameter_tampering'
  | 'unknown_action_type'
  | 'no_registered_executor'
  | 'already_executed'
  | 'idempotency_conflict'
  | 'concurrent_claim';

/** One entry in an action's append-only trail. */
export interface ActionAuditEntry {
  readonly id: string;
  readonly actionId: ActionId;
  readonly businessId: BusinessId;
  readonly fromStatus: ActionStatus | null;
  readonly toStatus: ActionStatus;
  readonly outcome: ActionAuditOutcome;
  readonly actorId: UserId | null;
  readonly actorRole: string;
  /** True when the actor was acting on a machine proposal rather than their own intent. */
  readonly actorIsMachine: boolean;
  readonly reason?: ActionDenialReason;
  readonly message: string;
  /** Stable idempotency key for the request that produced this entry. */
  readonly idempotencyKey?: string;
  /** Hash of the parameters at the moment of this transition. */
  readonly parametersHash: string;
  readonly executorId?: string;
  readonly createdAt: Date;
  readonly correlationId: string;
}