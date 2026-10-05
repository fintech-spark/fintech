import { createHash } from 'node:crypto';
import type {
  Action,
  ActionAuditEntry,
  ActionAuditOutcome,
  ActionDenialReason,
  ActionRiskTier,
  ActionStatus,
  ActionType,
} from './types';
import {
  ACTION_STATUS_TRANSITIONS,
  AUTO_EXECUTABLE_ACTION_TYPES,
  CONSEQUENTIAL_ACTION_TYPES,
} from './types';

// ---------------------------------------------------------------------------
// State machine — preserved published behaviour
// ---------------------------------------------------------------------------

/**
 * Whether a transition is permitted.
 *
 * An unrecognised status on either side returns `false` rather than throwing: a
 * caller with a malformed or future status must fail closed, not crash the
 * request and leave the action in an unknown state.
 */
export function canTransitionActionTo(current: ActionStatus, next: ActionStatus): boolean {
  const allowed = ACTION_STATUS_TRANSITIONS[current];
  if (allowed === undefined) return false;
  return allowed.includes(next);
}

export function requiresApproval(status: ActionStatus): boolean {
  return status === 'awaiting_approval';
}

export function canCancel(status: ActionStatus): boolean {
  return ['proposed', 'drafted', 'awaiting_approval'].includes(status);
}

export function canRetryAction(status: ActionStatus): boolean {
  return status === 'failed';
}

// ---------------------------------------------------------------------------
// Approval policy
//
// These are the controls the AI Action Policy document requires to exist in the
// application layer: "requires explicit, fresh user confirmation immediately
// before execution" and "re-checks authorization, target, scope, amount and
// idempotency server-side". They live here, in code, because a prompt is not a
// control.
// ---------------------------------------------------------------------------

/**
 * How long an approval remains valid before it must be given again.
 *
 * Fifteen minutes matches "fresh confirmation". Without this window an approval
 * granted in the morning could be executed in the evening against data that has
 * since changed, which is exactly the gap a replay attack targets.
 */
export const APPROVAL_TTL_MS = 15 * 60 * 1000;

/** Roles permitted to approve an action. */
export const APPROVER_ROLES: readonly string[] = ['owner', 'admin', 'manager'];

/** Roles permitted to execute an approved action. Aligned with auth-context actions:execute. */
export const EXECUTOR_ROLES: readonly string[] = ['owner'];

/** Roles permitted to propose or draft an action. Proposing has no effect. */
export const PROPOSER_ROLES: readonly string[] = [
  'owner',
  'admin',
  'manager',
  'accountant',
  'staff',
];

/**
 * Risk classification for an action type.
 *
 * Every type that spends money, changes a financial record, or communicates
 * externally is `consequential`. `AUTO_EXECUTABLE_ACTION_TYPES` is empty, so today
 * no action type is low risk and every action therefore requires two people.
 * That is the deliberately strict posture; widening it is a product decision,
 * not a refactor.
 */
export function classifyRisk(type: ActionType): ActionRiskTier {
  if (AUTO_EXECUTABLE_ACTION_TYPES.includes(type)) return 'low';
  if (CONSEQUENTIAL_ACTION_TYPES.includes(type)) return 'consequential';
  return 'consequential';
}

/**
 * Whether the proposer may not also approve.
 *
 * Secure by default: true for every consequential action, and additionally for
 * anything the AI proposed, regardless of its type. A machine proposal always
 * gets a second pair of eyes.
 *
 * PRODUCT DECISION REQUIRED: because `AUTO_EXECUTABLE_ACTION_TYPES` is empty, this
 * currently requires a second approver for EVERY action type, including a manual
 * stock reorder. That is the safe posture, but it means a business with a single
 * owner and no admin or manager cannot approve anything. The policy is injected so
 * a deployment can relax it deliberately, with an audit trail of who chose to.
 */
export function requiresDistinctApprover(
  action: Pick<Action, 'type' | 'source'>,
  policy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
): boolean {
  if (action.source === 'ai_recommendation') return true;
  if (policy.requireDistinctApproverForEveryType) {
    return classifyRisk(action.type) !== 'low';
  }
  return CONSEQUENTIAL_ACTION_TYPES.includes(action.type);
}

/** Injectable approval policy. */
export interface ApprovalPolicy {
  /**
   * When true, any non-low-risk type needs a second approver. When false, only the
   * explicitly consequential types do.
   */
  readonly requireDistinctApproverForEveryType: boolean;
}

/**
 * Secure default: two people for everything except a type explicitly marked
 * auto-executable, which today means every action.
 */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  requireDistinctApproverForEveryType: true,
};

/** Roles allowed to approve. */
export function canApprove(role: string): boolean {
  return APPROVER_ROLES.includes(role);
}

/** Roles allowed to execute. */
export function canExecute(role: string): boolean {
  return EXECUTOR_ROLES.includes(role);
}

/** Roles allowed to propose. */
export function canPropose(role: string): boolean {
  return PROPOSER_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Execution preconditions
// ---------------------------------------------------------------------------

export interface ExecutionCheck {
  readonly allowed: boolean;
  readonly reason?: ActionDenialReason;
  readonly explanation: string;
}

/**
 * Every precondition for executing one action, evaluated server-side at the
 * moment of execution.
 *
 * This is the security boundary. It re-reads the action's live state rather than
 * trusting anything the caller sent, and it re-checks the approver, the tenant,
 * the clock and the parameter hash. A caller cannot influence any input here
 * except through the action's own stored record.
 */
export function checkExecutionPreconditions(input: {
  readonly action: Action;
  readonly actorId: string;
  readonly actorRole: string;
  readonly sameTenant: boolean;
  readonly now: Date;
  readonly registeredExecutorTypes: ReadonlySet<ActionType>;
  readonly parametersHashAtApproval: string | undefined;
  readonly executionIdempotencyKey?: string;
  readonly keyAlreadyUsedByAnotherAction?: boolean;
  readonly approvalPolicy?: ApprovalPolicy;
}): ExecutionCheck {
  const { action, actorId, actorRole, sameTenant, now } = input;

  if (!sameTenant || action.businessId === undefined) {
    return deny('cross_tenant', 'The action does not belong to the requesting business.');
  }
  if (!canExecute(actorRole)) {
    return deny(
      'insufficient_role',
      `Role "${actorRole}" is not permitted to execute actions.`,
    );
  }
  if (!input.registeredExecutorTypes.has(action.type)) {
    return deny(
      'no_registered_executor',
      `No executor is registered for action type "${action.type}".`,
    );
  }
  if (action.status !== 'approved') {
    if (action.status === 'executing' || action.status === 'completed') {
      return deny('already_executed', `The action is already ${action.status}.`);
    }
    return deny(
      'invalid_state_transition',
      `An action in state "${action.status}" cannot be executed; it must be "approved" first.`,
    );
  }
  if (action.approvedBy === undefined || action.approvedAt === undefined) {
    return deny('approval_required', 'The action has no recorded approval.');
  }
  // The proposer may not execute their own proposal. The check is against
  // `createdBy`, NOT `approvedBy`: comparing against the approver would forbid the
  // approver from carrying out what they just authorised, which is the normal and
  // intended flow and would leave a consequential action with nobody able to run it.
  if (
    requiresDistinctApprover(action, input.approvalPolicy) &&
    (action.createdBy === actorId || action.createdBy === action.approvedBy)
  ) {
    return deny(
      'self_approval_forbidden',
      'The person who proposed this action may not execute it.',
    );
  }
  const approvalAge = now.getTime() - action.approvedAt.getTime();
  if (approvalAge > APPROVAL_TTL_MS) {
    return deny(
      'approval_expired',
      `The approval is ${Math.round(approvalAge / 60_000)} minute(s) old; it must be renewed.`,
    );
  }
  if (!Number.isFinite(approvalAge) || approvalAge < 0) {
    return deny('approval_replay', 'The recorded approval time is in the future.');
  }

  const currentHash = hashActionParameters(action);
  if (
    input.parametersHashAtApproval === undefined ||
    input.parametersHashAtApproval !== currentHash
  ) {
    return deny(
      'parameter_tampering',
      'The action parameters changed after approval and the request was refused.',
    );
  }
  if (input.keyAlreadyUsedByAnotherAction === true) {
    return deny(
      'idempotency_conflict',
      'The supplied idempotency key is already bound to a different action.',
    );
  }

  return {
    allowed: true,
    explanation:
      `Approved by a permitted role at ${action.approvedAt.toISOString()}; parameters verified unchanged.`,
  };
}

/** Approval preconditions, evaluated at the moment of approval. */
export function checkApprovalPreconditions(input: {
  readonly action: Action;
  readonly actorId: string;
  readonly actorRole: string;
  readonly sameTenant: boolean;
  readonly approvalPolicy?: ApprovalPolicy;
}): ExecutionCheck {
  const { action, actorId, actorRole, sameTenant } = input;

  if (!sameTenant) {
    return deny('cross_tenant', 'The action does not belong to the requesting business.');
  }
  if (!canApprove(actorRole)) {
    return deny('insufficient_role', `Role "${actorRole}" is not permitted to approve actions.`);
  }
  if (action.status !== 'awaiting_approval') {
    return deny(
      'invalid_state_transition',
      `Only an action awaiting approval can be approved; this one is "${action.status}".`,
    );
  }
  if (
    requiresDistinctApprover(action, input.approvalPolicy) &&
    action.createdBy === actorId
  ) {
    return deny(
      'self_approval_forbidden',
      'This action was proposed by the same person and needs a second approver.',
    );
  }
  return { allowed: true, explanation: 'Approver holds a permitted role and the action awaits approval.' };
}

function deny(reason: ActionDenialReason, explanation: string): ExecutionCheck {
  return { allowed: false, reason, explanation };
}

// ---------------------------------------------------------------------------
// Tamper detection
// ---------------------------------------------------------------------------

/**
 * SHA-256 binds approvals and execution keys without attacker-feasible collisions.
 */
function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * SHA-256 content hash of an action's parameters.
 *
 * Keys are sorted and values are canonicalised so that a semantically identical
 * parameter set always hashes identically regardless of insertion order. Any
 * edit between approval and execution changes the hash and is refused.
 */
export function hashActionParameters(action: Pick<Action, 'parameters' | 'type'>): string {
  return hashString(canonicalize({ type: action.type, parameters: action.parameters }));
}

/** Stable, collision-resistant encoding of a JSON-like value. */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undef';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'nonfinite';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`);
    return `{${entries.join(',')}}`;
  }
  return 'unsupported';
}

/**
 * Execution idempotency key for an action.
 *
 * Derived from the action id and the caller's optional request key, so a retry of
 * the same request collapses to the same key while two genuinely different
 * requests stay distinguishable.
 */
export function executionIdempotencyKey(actionId: string, requestKey?: string): string {
  return hashString(`${actionId}\u001f${requestKey ?? 'execute'}`);
}

// ---------------------------------------------------------------------------
// Audit assembly
// ---------------------------------------------------------------------------

/**
 * Builds one audit entry.
 *
 * The message is assembled here rather than logged so the trail is identical
 * whether or not a structured logger is wired up. Nothing sensitive is ever
 * placed in it: parameters contribute only a hash, never their contents.
 */
export function buildAuditEntry(input: {
  readonly id: string;
  readonly action: Action;
  readonly fromStatus: ActionStatus | null;
  readonly toStatus: ActionStatus;
  readonly outcome: ActionAuditOutcome;
  readonly actorId: string | null;
  readonly actorRole: string;
  readonly actorIsMachine: boolean;
  readonly reason?: ActionDenialReason;
  readonly message: string;
  readonly idempotencyKey?: string;
  readonly executorId?: string;
  readonly now: Date;
  readonly correlationId: string;
}): ActionAuditEntry {
  return {
    id: input.id,
    actionId: input.action.id,
    businessId: input.action.businessId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    outcome: input.outcome,
    actorId: input.actorId === null ? null : (input.actorId as ActionAuditEntry['actorId']),
    actorRole: input.actorRole,
    actorIsMachine: input.actorIsMachine,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    message: input.message,
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    parametersHash: hashActionParameters(input.action),
    ...(input.executorId === undefined ? {} : { executorId: input.executorId }),
    createdAt: input.now,
    correlationId: input.correlationId,
  };
}

/** True when a denial reason describes an authorization failure rather than a bug. */
export function isAuthorizationDenial(reason: ActionDenialReason): boolean {
  return (
    reason === 'not_authenticated' ||
    reason === 'insufficient_role' ||
    reason === 'cross_tenant' ||
    reason === 'approval_required' ||
    reason === 'self_approval_forbidden' ||
    reason === 'unknown_action_type'
  );
}

/** True when a denial means a duplicate request, as opposed to a rejected one. */
export function isReplayDenial(reason: ActionDenialReason): boolean {
  return (
    reason === 'already_executed' ||
    reason === 'approval_replay' ||
    reason === 'concurrent_claim' ||
    reason === 'idempotency_conflict'
  );
}
