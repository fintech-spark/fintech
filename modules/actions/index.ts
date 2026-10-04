import type { PaginatedResult, TenantContext } from '@/lib/types';

// Public API of the actions module.
//
// Consumers import from `@/modules/actions` only.
//
// ---------------------------------------------------------------------------
// SECURITY CONTRACT — read before calling anything here
// ---------------------------------------------------------------------------
//
// * NOTHING EXECUTES WITHOUT AN APPROVAL RECORD. `execute` re-reads the action
//   and refuses unless its stored status is `approved` with a recorded approver
//   and an approval no older than `APPROVAL_TTL_MS`.
// * EXECUTION HAPPENS EXACTLY ONCE. `claimForExecution` is a single conditional
//   UPDATE. Concurrent or repeated requests produce one real execution; the rest
//   are refused as `concurrent_claim` or `already_executed` and both are audited.
// * EXECUTORS ARE ALLOWLISTED BY ACTION TYPE. The registry is frozen at
//   composition time, refuses a runtime registration, and refuses to let a
//   dedicated executor claim `custom`. An unregistered type fails closed with
//   `no_registered_executor`.
// * PARAMETERS ARE TAMPER-EVIDENT. The parameter set is hashed at approval and
//   re-verified at execution; an edit in between is refused as
//   `parameter_tampering`.
// * SEGREGATION OF DUTIES. A consequential action, or one proposed by the AI,
//   cannot be approved by the person who proposed it.
// * TENANT SCOPE IS NEVER A PARAMETER. Every method derives the business from
//   `TenantContext`; an id belonging to another tenant produces `NotFoundError`.
// * THE MODEL CANNOT SKIP ANY OF THIS. It can call `propose` and nothing else.
//   Every control above is in the application layer, not in a prompt.
//
// Audit entries carry a parameter *hash*, never parameter contents, so no
// customer name, amount or message body is copied into the trail.

export type {
  Action,
  ActionAuditEntry,
  ActionAuditOutcome,
  ActionDenialReason,
  ActionResult,
  ActionRiskTier,
  ActionSource,
  ActionStatus,
  ActionType,
} from './domain/types';

export {
  ACTION_STATUS_TRANSITIONS,
  AUTO_EXECUTABLE_ACTION_TYPES,
  CONSEQUENTIAL_ACTION_TYPES,
} from './domain/types';

export {
  APPROVAL_TTL_MS,
  APPROVER_ROLES,
  buildAuditEntry,
  canApprove,
  canCancel,
  canExecute,
  canPropose,
  canRetryAction,
  canTransitionActionTo,
  canonicalize,
  checkApprovalPreconditions,
  DEFAULT_APPROVAL_POLICY,
  checkExecutionPreconditions,
  classifyRisk,
  executionIdempotencyKey,
  EXECUTOR_ROLES,
  hashActionParameters,
  isAuthorizationDenial,
  isReplayDenial,
  PROPOSER_ROLES,
  requiresApproval,
  requiresDistinctApprover,
  type ApprovalPolicy,
  type ExecutionCheck,
} from './domain/rules';

export {
  ACTION_PARAMETER_SPECS,
  ActionExecutorRegistry,
  createDefaultActionExecutorRegistry,
  refusingExecutor,
  STANDARD_ACTION_EXECUTORS,
  validateActionParameters,
  type ActionExecutor,
  type ActionLogger,
  type ExecutorContext,
  type ExecutorOutcome,
} from './domain/executors';

import type {
  ActionFilterInput,
  ExecuteActionInput,
  ExecutionOutcome,
  ProposeActionInput,
} from './application/postgres-action-service';
import type { Action, ActionAuditEntry } from './domain/types';

export type {
  ActionFilterInput,
  ExecuteActionInput,
  ExecutionOutcome,
  ProposeActionInput,
};

export { PostgresActionService } from './application/postgres-action-service';

/**
 * Application contract for secure action execution.
 *
 * Declared here as an interface so a route handler or an AI tool can depend on
 * the capability without importing the concrete service, and so the registry can
 * register the capability without knowing its implementation.
 */
export interface ActionService {
  propose(ctx: TenantContext, input: ProposeActionInput): Promise<Action>;
  draft(ctx: TenantContext, id: string): Promise<Action>;
  requestApproval(ctx: TenantContext, id: string): Promise<Action>;
  approve(ctx: TenantContext, id: string): Promise<Action>;
  reject(ctx: TenantContext, id: string, reason: string): Promise<Action>;
  cancel(ctx: TenantContext, id: string, reason?: string): Promise<Action>;
  execute(ctx: TenantContext, input: ExecuteActionInput): Promise<ExecutionOutcome>;
  getById(ctx: TenantContext, id: string): Promise<Action | null>;
  list(ctx: TenantContext, filters: ActionFilterInput): Promise<PaginatedResult<Action>>;
  findPendingApproval(ctx: TenantContext): Promise<readonly Action[]>;
  listAudit(ctx: TenantContext, id: string): Promise<readonly ActionAuditEntry[]>;
}

export type {
  ActionFilters,
  ActionRepository,
} from './infrastructure/repository';

export {
  appendAuditInTransaction,
  PostgresActionRepository,
  type ActionTransaction,
} from './infrastructure/postgres-action-repository';