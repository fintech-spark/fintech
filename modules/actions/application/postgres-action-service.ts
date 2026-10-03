import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import {
  asUserId,
  type PaginatedResult,
  type PaginationParams,
  type TenantContext,
} from '@/lib/types';
import type { Clock } from '@/lib/clock';
import type { EventBus } from '@/lib/events';
import { randomUUID } from 'node:crypto';
import type { ApprovalPolicy } from '../domain/rules';
import {
  APPROVER_ROLES,
  DEFAULT_APPROVAL_POLICY,
  buildAuditEntry,
  canCancel,
  canPropose,
  canTransitionActionTo,
  checkApprovalPreconditions,
  checkExecutionPreconditions,
  executionIdempotencyKey,
  hashActionParameters,
} from '../domain/rules';
import { ActionExecutorRegistry, validateActionParameters } from '../domain/executors';
import type { ExecutorContext, ExecutorOutcome } from '../domain/executors';
import type {
  Action,
  ActionAuditEntry,
  ActionDenialReason,
  ActionSource,
  ActionStatus,
  ActionType,
} from '../domain/types';
import type { ActionRepository } from '../infrastructure/repository';

/** Input for proposing a new action. */
export interface ProposeActionInput {
  readonly type: ActionType;
  readonly title: string;
  readonly description: string;
  readonly source: ActionSource;
  readonly parameters: Readonly<Record<string, unknown>>;
  /** Makes proposal itself idempotent within the tenant. */
  readonly idempotencyKey?: string;
  readonly relatedLeakId?: string;
  readonly relatedRiskId?: string;
}

/** Input for executing an action. */
export interface ExecuteActionInput {
  readonly id: string;
  /** Caller-supplied key so a retried request collapses to one execution. */
  readonly idempotencyKey?: string;
}

export interface ActionFilterInput extends PaginationParams {
  readonly type?: ActionType;
  readonly status?: ActionStatus;
  readonly source?: ActionSource;
}

/**
 * Result of an execution attempt.
 *
 * `status` is reported rather than thrown for denials, because a caller needs to
 * distinguish "this was refused and here is why" from "the request was malformed".
 * A refusal is still an audit event, written before the result is returned.
 */
export interface ExecutionOutcome {
  readonly action: Action | null;
  readonly executed: boolean;
  readonly denialReason?: ActionDenialReason;
  readonly explanation: string;
  readonly auditEntryId: string;
}

const MAX_TITLE_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 5_000;

/**
 * Secure action service.
 *
 * The flow is deliberately linear and each step is independently testable:
 *
 *   propose  -> validate parameters, check role, persist as `proposed`
 *   draft    -> move to `drafted`
 *   request  -> move to `awaiting_approval`
 *   approve  -> re-check role, tenant and segregation of duties, record the actor
 *               and a parameter hash
 *   execute  -> re-check everything server-side, then atomically claim the
 *               action before invoking an allowlisted executor
 *   audit    -> every transition appends an entry, inside the same call
 *
 * The model can reach `propose` and nothing beyond it. Everything after approval
 * is gated by the checks above, which live in the application layer precisely so
 * that a prompt cannot influence them.
 */
export class PostgresActionService {
  constructor(
    private readonly repository: ActionRepository,
    private readonly executors: ActionExecutorRegistry,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
    private readonly approvalPolicy: ApprovalPolicy = DEFAULT_APPROVAL_POLICY,
  ) {}

  async propose(ctx: TenantContext, input: ProposeActionInput): Promise<Action> {
    if (!canPropose(ctx.role)) {
      throw new ValidationError(`Role "${ctx.role}" is not permitted to propose actions.`);
    }
    const action = buildProposedAction(ctx, input, this.clock.now());
    validateActionParameters(action);
    return this.repository.save(action);
  }

  /** Moves a proposed action into drafting. */
  async draft(ctx: TenantContext, id: string): Promise<Action> {
    return this.transition(ctx, id, 'drafted');
  }

  /** Moves a drafted action into the approval queue. */
  async requestApproval(ctx: TenantContext, id: string): Promise<Action> {
    return this.transition(ctx, id, 'awaiting_approval');
  }

  async approve(ctx: TenantContext, id: string): Promise<Action> {
    const action = await this.loadOwned(ctx, id);
    const check = checkApprovalPreconditions({
      action,
      actorId: ctx.userId,
      actorRole: ctx.role,
      sameTenant: true,
      approvalPolicy: this.approvalPolicy,
    });
    if (!check.allowed) {
      const reason = check.reason ?? 'invalid_state_transition';
      await this.recordDenial(ctx, action, 'approved', reason, check.explanation);
      throw new ConflictError(check.explanation, { reason });
    }

    const approvedAt = this.clock.now();
    const approved = await this.repository.recordApproval(
      ctx.businessId,
      action.id,
      asUserId(ctx.userId),
      approvedAt,
      hashActionParameters(action),
    );
    if (!approved) {
      throw new ConflictError('The action changed state before the approval could be recorded.', {
        reason: 'invalid_state_transition',
      });
    }

    const updated: Action = {
      ...action,
      status: 'approved',
      approvedBy: asUserId(ctx.userId),
      approvedAt,
      updatedAt: approvedAt,
    };
    await this.appendAudit(ctx, updated, 'awaiting_approval', 'approved', 'allowed', {
      message: check.explanation,
    });
    await this.publish(updated, 'action.approved', ctx.userId);
    return updated;
  }

  async reject(ctx: TenantContext, id: string, reason: string): Promise<Action> {
    const action = await this.loadOwned(ctx, id);
    if (action.status !== 'awaiting_approval') {
      throw new ConflictError(
        `Only an action awaiting approval can be rejected; this one is "${action.status}".`,
        { reason: 'invalid_state_transition' },
      );
    }
    return this.cancel(ctx, id, `rejected: ${reason.slice(0, 200)}`);
  }

  async cancel(ctx: TenantContext, id: string, reason = 'cancelled by request'): Promise<Action> {
    const action = await this.loadOwned(ctx, id);
    if (!canCancel(action.status)) {
      throw new ConflictError(`An action in state "${action.status}" cannot be cancelled.`, {
        reason: 'invalid_state_transition',
      });
    }
    const now = this.clock.now();
    const updated: Action = { ...action, status: 'cancelled', updatedAt: now };
    await this.repository.update(updated);
    await this.appendAudit(ctx, updated, action.status, 'cancelled', 'allowed', {
      message: reason.slice(0, 500),
    });
    return updated;
  }

  /**
   * Executes an approved action exactly once.
   *
   * Order matters and is security-relevant:
   *   1. load the action, scoped to the tenant
   *   2. evaluate every precondition against the loaded record
   *   3. atomically claim the action (`approved` -> `executing`)
   *   4. only then invoke an allowlisted executor
   *
   * Step 3 is what makes duplicate and concurrent execution impossible: it
   * succeeds for exactly one caller regardless of how many requests arrive.
   */
  async execute(ctx: TenantContext, input: ExecuteActionInput): Promise<ExecutionOutcome> {
    const action = await this.loadOwnedOrNull(ctx, input.id);
    if (action === null) {
      throw new NotFoundError('Action', input.id);
    }

    const idempotencyKey = executionIdempotencyKey(action.id, input.idempotencyKey);
    const executorTypes = this.executors.types();
    const check = checkExecutionPreconditions({
      action,
      actorId: ctx.userId,
      actorRole: ctx.role,
      sameTenant: true,
      now: this.clock.now(),
      registeredExecutorTypes: executorTypes,
      parametersHashAtApproval: await this.repository.getApprovalHash(ctx.businessId, action.id),
      executionIdempotencyKey: idempotencyKey,
      keyAlreadyUsedByAnotherAction: await this.repository.isIdempotencyKeyBoundElsewhere(
        ctx.businessId,
        action.id,
        action.id,
      ),
      approvalPolicy: this.approvalPolicy,
    });

    if (!check.allowed) {
      const reason = check.reason ?? 'invalid_state_transition';
      const auditEntryId = await this.recordDenial(
        ctx,
        action,
        'executing',
        reason,
        check.explanation,
        idempotencyKey,
      );
      return {
        action,
        executed: false,
        denialReason: reason,
        explanation: check.explanation,
        auditEntryId,
      };
    }

    const executor = this.executors.resolve(action.type);
    if (executor === undefined) {
      const explanation = `No executor is registered for action type "${action.type}".`;
      const auditEntryId = await this.recordDenial(
        ctx,
        action,
        'executing',
        'no_registered_executor',
        explanation,
        idempotencyKey,
      );
      return {
        action,
        executed: false,
        denialReason: 'no_registered_executor',
        explanation,
        auditEntryId,
      };
    }

    const claimed = await this.repository.claimForExecution(
      ctx.businessId,
      action.id,
      this.clock.now(),
    );
    if (!claimed) {
      const explanation =
        'Another execution request claimed this action first; it will not run twice.';
      const auditEntryId = await this.recordDenial(
        ctx,
        action,
        'executing',
        'concurrent_claim',
        explanation,
        idempotencyKey,
      );
      return {
        action,
        executed: false,
        denialReason: 'concurrent_claim',
        explanation,
        auditEntryId,
      };
    }

    return this.runExecutor(ctx, action, executor, idempotencyKey);
  }

  /**
   * Runs the executor after a successful claim.
   *
   * A throw is captured as a typed failure rather than propagated, because an
   * action that has already been claimed must reach a terminal state; leaving it
   * in `executing` forever would be indistinguishable from a stuck worker.
   */
  private async runExecutor(
    ctx: TenantContext,
    action: Action,
    executor: NonNullable<ReturnType<ActionExecutorRegistry['resolve']>>,
    idempotencyKey: string,
  ): Promise<ExecutionOutcome> {
    const now = this.clock.now();
    let outcome: ExecutorOutcome;
    try {
      outcome = await executor.execute(action, buildExecutorContext(ctx, action));
    } catch (error) {
      outcome = {
        success: false,
        output: 'The executor failed unexpectedly.',
        errorCode: 'EXECUTOR_ERROR',
      };
      void error;
    }

    const status: Extract<ActionStatus, 'completed' | 'failed'> = outcome.success
      ? 'completed'
      : 'failed';
    const updated: Action = {
      ...action,
      status,
      executedAt: now,
      updatedAt: now,
      result: {
        success: outcome.success,
        output: outcome.output,
        ...(outcome.success ? {} : { error: outcome.output, errorCode: outcome.errorCode }),
        ...(outcome.affectedResources === undefined
          ? {}
          : { affectedResources: outcome.affectedResources }),
        executorId: executor.executorId,
      },
    };

    await this.repository.completeExecution(
      ctx.businessId,
      action.id,
      status,
      this.clock.now(),
    );
    const stored = { ...updated, id: action.id };
    await this.appendAudit(
      ctx,
      stored,
      'executing',
      status,
      'allowed',
      { message: outcome.output.slice(0, 500), executorId: executor.executorId, idempotencyKey },
    );
    await this.publish(stored, 'action.completed', ctx.userId);

    return {
      action: stored,
      executed: outcome.success,
      explanation: outcome.output,
      auditEntryId: '',
    };
  }

  async getById(ctx: TenantContext, id: string): Promise<Action | null> {
    assertOpaqueId(id, 'id');
    return this.repository.findById(ctx.businessId, id as Action['id']);
  }

  async list(ctx: TenantContext, filters: ActionFilterInput): Promise<PaginatedResult<Action>> {
    return this.repository.list(ctx.businessId, {
      ...(filters.type === undefined ? {} : { type: filters.type }),
      ...(filters.status === undefined ? {} : { status: filters.status }),
      ...(filters.source === undefined ? {} : { source: filters.source }),
      page: normalisePage(filters.page),
      limit: normaliseLimit(filters.limit),
    });
  }

  async findPendingApproval(ctx: TenantContext): Promise<readonly Action[]> {
    return this.repository.findPendingApproval(ctx.businessId);
  }

  async listAudit(ctx: TenantContext, id: string): Promise<readonly ActionAuditEntry[]> {
    assertOpaqueId(id, 'id');
    return this.repository.listAudit(ctx.businessId, id as Action['id']);
  }

  /** Roles permitted to approve, exposed so the API layer can render controls. */
  static approverRoles(): readonly string[] {
    return APPROVER_ROLES;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async transition(
    ctx: TenantContext,
    id: string,
    next: ActionStatus,
  ): Promise<Action> {
    const action = await this.loadOwned(ctx, id);
    if (!canTransitionActionTo(action.status, next)) {
      throw new ConflictError(
        `An action cannot move from "${action.status}" to "${next}".`,
        { reason: 'invalid_state_transition' },
      );
    }
    const updated: Action = { ...action, status: next, updatedAt: this.clock.now() };
    await this.repository.update(updated);
    await this.appendAudit(ctx, updated, action.status, next, 'allowed', {
      message: `Moved to ${next}.`,
    });
    if (next === 'awaiting_approval') {
      await this.publish(updated, 'action.proposed', ctx.userId);
    }
    return updated;
  }

  /**
   * Loads an action and proves tenant ownership.
   *
   * A cross-tenant id produces `NotFoundError` rather than a partial result, so a
   * caller cannot learn that an action id exists in another business.
   */
  private async loadOwned(ctx: TenantContext, id: string): Promise<Action> {
    const action = await this.loadOwnedOrNull(ctx, id);
    if (action === null) throw new NotFoundError('Action', id);
    return action;
  }

  private async loadOwnedOrNull(ctx: TenantContext, id: string): Promise<Action | null> {
    assertOpaqueId(id, 'id');
    return this.repository.findById(ctx.businessId, id as Action['id']);
  }

  private async recordDenial(
    ctx: TenantContext,
    action: Action,
    toStatus: ActionStatus,
    reason: ActionDenialReason,
    message: string,
    idempotencyKey?: string,
  ): Promise<string> {
    const entry = buildAuditEntry({
      id: randomUUID(),
      action,
      fromStatus: action.status,
      toStatus,
      outcome: 'denied',
      actorId: asUserId(ctx.userId),
      actorRole: ctx.role,
      actorIsMachine: false,
      reason,
      message,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      now: this.clock.now(),
      correlationId: ctx.correlationId,
    });
    await this.repository.appendAudit(entry);
    return entry.id;
  }

  private async appendAudit(
    ctx: TenantContext,
    action: Action,
    fromStatus: ActionStatus,
    toStatus: ActionStatus,
    outcome: 'allowed' | 'denied',
    extras: { message: string; executorId?: string; idempotencyKey?: string },
  ): Promise<void> {
    const entry = buildAuditEntry({
      id: randomUUID(),
      action,
      fromStatus,
      toStatus,
      outcome,
      actorId: asUserId(ctx.userId),
      actorRole: ctx.role,
      actorIsMachine: false,
      message: extras.message,
      ...(extras.executorId === undefined ? {} : { executorId: extras.executorId }),
      ...(extras.idempotencyKey === undefined ? {} : { idempotencyKey: extras.idempotencyKey }),
      now: this.clock.now(),
      correlationId: ctx.correlationId,
    });
    await this.repository.appendAudit(entry);
  }

  private async publish(
    action: Action,
    type: 'action.proposed' | 'action.approved' | 'action.completed',
    actorId: string,
  ): Promise<void> {
    if (type === 'action.proposed') {
      await this.eventBus.publish({
        id: `action-proposed-${action.id}`,
        type,
        businessId: action.businessId,
        timestamp: this.clock.now(),
        correlationId: `action-${action.id}`,
        actorId: asUserId(actorId),
        payload: { actionId: action.id, type: action.type, source: action.source },
      });
      return;
    }
    if (type === 'action.approved') {
      await this.eventBus.publish({
        id: `action-approved-${action.id}`,
        type,
        businessId: action.businessId,
        timestamp: this.clock.now(),
        correlationId: `action-${action.id}`,
        actorId: asUserId(actorId),
        payload: { actionId: action.id, approvedBy: asUserId(actorId) },
      });
      return;
    }
    await this.eventBus.publish({
      id: `action-completed-${action.id}`,
      type,
      businessId: action.businessId,
      timestamp: this.clock.now(),
      correlationId: `action-${action.id}`,
      payload: {
        actionId: action.id,
        result: action.result === undefined ? {} : { success: action.result.success },
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Construction helpers
// ---------------------------------------------------------------------------

function buildProposedAction(
  ctx: TenantContext,
  input: ProposeActionInput,
  now: Date,
): Action {
  if (typeof input.title !== 'string' || input.title.trim().length === 0) {
    throw new ValidationError('An action title is required.');
  }
  if (input.title.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(`An action title may be at most ${MAX_TITLE_LENGTH} characters.`);
  }
  if (typeof input.description !== 'string' || input.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `An action description may be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  if (input.idempotencyKey !== undefined) {
    if (
      input.idempotencyKey.length === 0 ||
      input.idempotencyKey.length > 255
    ) {
      throw new ValidationError('An idempotency key must be 1 to 255 characters.');
    }
  }

  return {
    id: randomUUID() as Action['id'],
    businessId: ctx.businessId,
    type: input.type,
    title: input.title.trim(),
    description: input.description,
    status: 'proposed',
    source: input.source,
    parameters: input.parameters,
    createdAt: now,
    updatedAt: now,
    createdBy: asUserId(ctx.userId),
    currency: 'INR',
    ...(input.relatedLeakId === undefined ? {} : { relatedLeakId: input.relatedLeakId }),
    ...(input.relatedRiskId === undefined ? {} : { relatedRiskId: input.relatedRiskId }),
  };
}

function buildExecutorContext(ctx: TenantContext, action: Action): ExecutorContext {
  return {
    tenant: ctx,
    correlationId: ctx.correlationId,
    machineProposed: action.source === 'ai_recommendation',
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
    },
  };
}

function normalisePage(page?: number): number {
  return typeof page === 'number' && Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

function normaliseLimit(limit?: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(100, Math.floor(limit));
}

function assertOpaqueId(value: string, field: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    throw new ValidationError(`${field} must be a non-empty identifier of at most 128 characters.`);
  }
}

