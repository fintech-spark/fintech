// The twelve required action red-team attacks, plus the extra abuse cases.
//
// Split from `actions-security.test.ts` to keep both files inside the repository's
// 800-line ceiling. Every case asserts a DENIAL, a single real execution, or an
// absence of side effects; none of them asserts a successful attack.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  APPROVAL_TTL_MS,
  ActionExecutorRegistry,
  PostgresActionService,
  type Action,
  type ActionAuditEntry,
  type ActionExecutor,
  type ActionType,
  buildAuditEntry,
  isAuthorizationDenial,
  isReplayDenial,
  type ExecutionOutcome,
} from '@/modules/actions';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createEventBus } from '@/lib/events';
import {
  TENANT_A,
  TENANT_B,
  fixedClockAt,
  tenantFor,
} from './support/doubles';
import {
  InMemoryActionRepository,
} from './support/action-doubles';

const NOW = new Date('2026-02-01T12:00:00.000Z');

class CountingExecutor implements ActionExecutor {
  invocations = 0;
  constructor(
    readonly executorId: string,
    readonly handles: ActionType,
    private readonly outcome: { success: boolean; output: string },
  ) {}

  execute(): Promise<{ success: boolean; output: string; executorId: string }> {
    this.invocations += 1;
    return Promise.resolve({ ...this.outcome, executorId: this.executorId });
  }
}

function registryWith(executors: ActionExecutor[]): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry();
  for (const executor of executors) registry.register(executor);
  return registry.freeze();
}

function mutableClock(start: Date) {
  let current = start;
  return {
    clock: { now: () => new Date(current.getTime()) },
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

function reminderParameters(idempotencyKey?: string) {
  return {
    customerId: 'customer-1',
    channel: 'email',
    body: 'Your payment is overdue. Please settle the outstanding balance.',
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

// ---------------------------------------------------------------------------
// RED TEAM: the twelve required attack scenarios
// ---------------------------------------------------------------------------

describe('action red team', () => {
  let repository: InMemoryActionRepository;
  let executor: CountingExecutor;
  let service: PostgresActionService;
  let bus: ReturnType<typeof createEventBus>;
  let time: ReturnType<typeof mutableClock>;

  const owner = tenantFor(TENANT_A, 'owner', 'user-owner');
  const otherOwner = tenantFor(TENANT_A, 'owner', 'user-other-owner');
  const manager = tenantFor(TENANT_A, 'manager', 'user-manager');
  const accountant = tenantFor(TENANT_A, 'accountant', 'user-accountant');
  const staff = tenantFor(TENANT_A, 'staff', 'user-staff');
  const intruder = tenantFor(TENANT_B, 'owner', 'user-intruder');

  beforeEach(() => {
    repository = new InMemoryActionRepository();
    executor = new CountingExecutor('test-reminder', 'send_reminder', {
      success: true,
      output: 'Reminder queued.',
    });
    bus = createEventBus();
    time = mutableClock(NOW);
    service = new PostgresActionService(repository, registryWith([executor]), time.clock, bus);
  });

  async function approvedReminder(idempotencyKey?: string): Promise<Action> {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Chase overdue payment',
      description: 'Send a payment reminder to an overdue customer.',
      source: 'ai_recommendation',
      parameters: reminderParameters(idempotencyKey),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    // Approved by a second person: the proposer may not approve their own action.
    return service.approve(otherOwner, action.id);
  }

  // 1. Execute without approval
  it('1. DENIES execution without approval', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'No approval',
      description: 'Proposed but never approved.',
      source: 'ai_recommendation',
      parameters: reminderParameters(),
    });
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('invalid_state_transition');
    expect(executor.invocations).toBe(0);
  });

  it('1b. DENIES execution of a merely proposed action', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Only proposed',
      description: 'Still in the proposed state.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(executor.invocations).toBe(0);
  });

  // 2. Approve another tenant's action
  it('2. DENIES approval of another tenant action', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Tenant A action',
      description: 'Belongs to tenant A.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    await expect(service.approve(intruder, action.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await service.getById(owner, action.id)).toMatchObject({ status: 'awaiting_approval' });
  });

  // 3. Execute another tenant's action
  it('3. DENIES execution of another tenant action', async () => {
    const action = await approvedReminder();
    await expect(service.execute(intruder, { id: action.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(executor.invocations).toBe(0);
  });

  // 4. Execute the same action twice
  it('4. EXECUTES an action only once, however many times it is requested', async () => {
    const action = await approvedReminder();
    const first = await service.execute(otherOwner, { id: action.id });
    const second = await service.execute(otherOwner, { id: action.id });
    const third = await service.execute(manager, { id: action.id });

    expect(first.executed).toBe(true);
    expect(second.executed).toBe(false);
    expect(second.denialReason).toBe('already_executed');
    expect(third.executed).toBe(false);
    expect(executor.invocations).toBe(1);
  });

  it('4b. Collapses a retried request carrying the same idempotency key', async () => {
    const action = await approvedReminder();
    const first = await service.execute(otherOwner, { id: action.id, idempotencyKey: 'req-1' });
    const retry = await service.execute(otherOwner, { id: action.id, idempotencyKey: 'req-1' });
    expect(first.executed).toBe(true);
    expect(retry.executed).toBe(false);
    expect(executor.invocations).toBe(1);
  });

  // 5. Execute a rejected action
  it('5. DENIES execution of a rejected action', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Will be rejected',
      description: 'Rejected by the approver.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    await service.reject(otherOwner, action.id, 'not appropriate');
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('invalid_state_transition');
    expect(executor.invocations).toBe(0);
  });

  // 6. Execute a cancelled action
  it('6. DENIES execution of a cancelled action', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Will be cancelled',
      description: 'Cancelled by the proposer.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await service.cancel(owner, action.id);
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(executor.invocations).toBe(0);
  });

  // 7. Concurrent execution
  it('7. PERMITS exactly one execution under concurrent requests', async () => {
    const action = await approvedReminder();
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => service.execute(otherOwner, { id: action.id })),
    );
    expect(attempts.filter((attempt) => attempt.executed)).toHaveLength(1);
    expect(executor.invocations).toBe(1);
  });

  // 8. Tamper with parameters after approval
  it('8. DETECTS parameter tampering after approval', async () => {
    const action = await approvedReminder();
    const tampered: Action = {
      ...action,
      parameters: { ...action.parameters, customerId: 'victim-customer' },
    };
    await repository.update(tampered);

    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('parameter_tampering');
    expect(executor.invocations).toBe(0);
  });

  // 9. Forge an action type
  it('9. DENIES an action type with no registered executor', async () => {
    const action = await service.propose(owner, {
      type: 'create_transaction',
      title: 'Forge a financial record',
      description: 'No executor is configured for this type.',
      source: 'manual',
      parameters: { counterpartyId: 'c1', totalMinor: 100, transactionDate: NOW.toISOString() },
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    const approved = await service.approve(manager, action.id);

    const outcome = await service.execute(otherOwner, { id: approved.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('no_registered_executor');
  });

  it('9b. FAILS CLOSED for an unconfigured type even when approved', async () => {
    const registry = new ActionExecutorRegistry().freeze();
    const isolated = new PostgresActionService(repository, registry, time.clock, bus);
    const action = await isolated.propose(owner, {
      type: 'send_reminder',
      title: 'No executor at all',
      description: 'The registry is empty.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await isolated.draft(owner, action.id);
    await isolated.requestApproval(owner, action.id);
    const approved = await isolated.approve(manager, action.id);
    const outcome: ExecutionOutcome = await isolated.execute(otherOwner, { id: approved.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('no_registered_executor');
  });

  // 10. Malicious target ids
  it('10. REJECTS a malformed or oversized action id', async () => {
    await expect(service.execute(owner, { id: '' })).rejects.toBeInstanceOf(ValidationError);
    await expect(service.execute(owner, { id: 'x'.repeat(129) })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('10b. REJECTS a hostile value in a declared parameter', async () => {
    await expect(
      service.propose(owner, {
        type: 'send_reminder',
        title: 'Hostile body',
        description: 'Attempts an injection through a declared field.',
        source: 'ai_recommendation',
        parameters: { ...reminderParameters(), body: 'x'.repeat(5_000) },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // 11. Replay an old approval
  it('11. DENIES execution under an expired approval', async () => {
    const action = await approvedReminder();
    time.advance(APPROVAL_TTL_MS + 60_000);
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('approval_expired');
    expect(executor.invocations).toBe(0);
  });

  it('11b. ALLOWS execution inside the freshness window', async () => {
    const action = await approvedReminder();
    time.advance(APPROVAL_TTL_MS - 60_000);
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(true);
    expect(executor.invocations).toBe(1);
  });

  it('11c. DENIES an approval timestamped in the future', async () => {
    const action = await approvedReminder();
    const shifted: Action = {
      ...action,
      approvedAt: new Date(NOW.getTime() + 60_000),
    };
    await repository.update(shifted);
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('approval_replay');
  });

  // 12. Bypass approval by invoking the executor directly
  it('12. The service is the only path to an executor', async () => {
    // The registry is the only place an executor lives, and only the service
    // resolves one — after re-checking every precondition. Reaching an executor
    // directly is not enough: an unapproved action still cannot reach one.
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Proposed only',
      description: 'No approval step was taken.',
      source: 'ai_recommendation',
      parameters: reminderParameters(),
    });
    await service.execute(otherOwner, { id: action.id });
    expect(executor.invocations).toBe(0);
  });

  // Additional red-team cases
  it('DENIES self-approval of a machine-proposed action', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'AI proposal',
      description: 'Proposed by the AI on the owner behalf.',
      source: 'ai_recommendation',
      parameters: reminderParameters(),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    await expect(service.approve(owner, action.id)).rejects.toThrow(/second approver/i);
  });

  it('DENIES approval by a role without approval rights', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Needs approval',
      description: 'Awaiting an authorised approver.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    await expect(service.approve(accountant, action.id)).rejects.toThrow(/not permitted/i);
  });

  it('DENIES execution by a role without execution rights', async () => {
    const action = await approvedReminder();
    const outcome = await service.execute(staff, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('insufficient_role');
    expect(executor.invocations).toBe(0);
  });

  it('DENIES a double approval and preserves the first approver', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Single approval only',
      description: 'Approved once.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    const first = await service.approve(otherOwner, action.id);
    await expect(service.approve(owner, action.id)).rejects.toBeInstanceOf(ConflictError);
    const stored = await service.getById(owner, action.id);
    expect(stored?.approvedBy).toBe(first.approvedBy);
  });

  it('DENIES execution directly after approval without awaiting the queue', async () => {
    const action = await approvedReminder();
    expect(action.status).toBe('approved');
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(true);
  });

  it('DENIES execution by the person who proposed the action', async () => {
    const action = await approvedReminder();
    const outcome = await service.execute(owner, { id: action.id });
    expect(outcome.executed).toBe(false);
    expect(outcome.denialReason).toBe('self_approval_forbidden');
    expect(executor.invocations).toBe(0);
  });

  it('ALLOWS the approver to execute what they authorised', async () => {
    // Checking against the approver rather than the proposer would deadlock a
    // consequential action: nobody else could run it.
    const action = await approvedReminder();
    const outcome = await service.execute(otherOwner, { id: action.id });
    expect(outcome.executed).toBe(true);
    expect(executor.invocations).toBe(1);
  });

  it('DENIES an unknown action type at proposal time', async () => {
    await expect(
      service.propose(owner, {
        type: 'wire_transfer' as never,
        title: 'Invent a type',
        description: 'Not in the schema CHECK constraint.',
        source: 'manual',
        parameters: {},
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('DENIES a proposal from a role that may not propose', async () => {
    const stranger = { ...owner, role: 'guest' as never };
    await expect(
      service.propose(stranger, {
        type: 'send_reminder',
        title: 'x',
        description: 'y',
        source: 'manual',
        parameters: reminderParameters(),
      }),
    ).rejects.toThrow(/not permitted/i);
  });

  it('keeps one action per idempotency key within a tenant', async () => {
    const first = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Idempotent proposal',
      description: 'Same key.',
      source: 'manual',
      parameters: reminderParameters('key-1'),
    });
    const second = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Idempotent proposal',
      description: 'Same key.',
      source: 'manual',
      parameters: reminderParameters('key-1'),
    });
    expect(second.id).toBe(first.id);
    expect((await service.list(owner, {})).total).toBe(1);
  });

  it('separates idempotency keys across tenants', async () => {
    await service.propose(owner, {
      type: 'send_reminder',
      title: 'A',
      description: 'x',
      source: 'manual',
      parameters: reminderParameters('shared'),
    });
    await service.propose(intruder, {
      type: 'send_reminder',
      title: 'B',
      description: 'x',
      source: 'manual',
      parameters: reminderParameters('shared'),
    });
    expect((await service.list(owner, {})).total).toBe(1);
    expect((await service.list(intruder, {})).total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Audit completeness
// ---------------------------------------------------------------------------

describe('action audit trail', () => {
  let repository: InMemoryActionRepository;
  let executor: CountingExecutor;
  let service: PostgresActionService;
  const owner = tenantFor(TENANT_A, 'owner', 'user-owner');
  const otherOwner = tenantFor(TENANT_A, 'owner', 'user-other-owner');
  const approver = tenantFor(TENANT_A, 'manager', 'user-manager');

  beforeEach(() => {
    repository = new InMemoryActionRepository();
    executor = new CountingExecutor('test-reminder', 'send_reminder', {
      success: true,
      output: 'Reminder queued.',
    });
    service = new PostgresActionService(
      repository,
      registryWith([executor]),
      fixedClockAt(NOW),
      createEventBus(),
    );
  });

  async function fullLifecycle() {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Full lifecycle',
      description: 'Propose, approve, execute.',
      source: 'ai_recommendation',
      parameters: reminderParameters(),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    await service.approve(approver, action.id);
    await service.execute(otherOwner, { id: action.id });
    return action.id;
  }

  it('records every transition in order', async () => {
    const id = await fullLifecycle();
    const entries = await service.listAudit(owner, id);
    expect(entries.map((entry) => entry.toStatus)).toEqual([
      'drafted',
      'awaiting_approval',
      'approved',
      'completed',
    ]);
    for (const entry of entries) {
      expect(entry.businessId).toBe(TENANT_A);
      expect(entry.correlationId).toBeTruthy();
      expect(entry.parametersHash).toMatch(/^[0-9a-f]{8}$/);
      expect(entry.createdAt).toBeInstanceOf(Date);
    }
  });

  it('records the actor, role and previous state for each transition', async () => {
    const id = await fullLifecycle();
    const entries = await service.listAudit(owner, id);
    const approval = entries.find((entry) => entry.toStatus === 'approved');
    expect(approval?.actorId).toBe('user-manager');
    expect(approval?.actorRole).toBe('manager');
    expect(approval?.fromStatus).toBe('awaiting_approval');
    expect(approval?.outcome).toBe('allowed');
  });

  it('records a denial with its reason and a machine flag that is always false', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Will fail',
      description: 'Executed without approval.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await service.execute(otherOwner, { id: action.id });
    const entries = await service.listAudit(owner, action.id);
    const denial = entries.find((entry) => entry.outcome === 'denied');
    expect(denial?.reason).toBe('invalid_state_transition');
    expect(denial?.actorIsMachine).toBe(false);
  });

  it('never writes action parameters into the audit trail', async () => {
    const id = await fullLifecycle();
    const entries = await service.listAudit(owner, id);
    const serialised = JSON.stringify(entries);
    expect(serialised).not.toContain('Your payment is overdue');
    expect(serialised).not.toContain('customer-1');
  });

  it('never writes an idempotency key into an unrelated entry', async () => {
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Keyed',
      description: 'x',
      source: 'manual',
      parameters: reminderParameters('secret-key'),
    });
    const entries = await service.listAudit(owner, action.id);
    expect(JSON.stringify(entries)).not.toContain('secret-key');
  });

  it('scopes the audit trail to the tenant', async () => {
    const id = await fullLifecycle();
    const intruder = tenantFor(TENANT_B, 'owner', 'user-intruder');
    expect(await service.listAudit(intruder, id)).toEqual([]);
  });

  it('distinguishes an authorization denial from a replay', () => {
    expect(isAuthorizationDenial('insufficient_role')).toBe(true);
    expect(isAuthorizationDenial('cross_tenant')).toBe(true);
    expect(isAuthorizationDenial('parameter_tampering')).toBe(false);
    expect(isReplayDenial('already_executed')).toBe(true);
    expect(isReplayDenial('approval_replay')).toBe(true);
    expect(isReplayDenial('insufficient_role')).toBe(false);
  });

  it('builds an audit entry without leaking parameter values', () => {
    const action: Action = {
      id: 'a1' as Action['id'],
      businessId: TENANT_A,
      type: 'send_reminder',
      title: 't',
      description: 'd',
      status: 'approved',
      source: 'manual',
      parameters: reminderParameters('super-secret-key'),
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: 'user-owner' as Action['createdBy'],
      currency: 'INR',
    };
    const entry: ActionAuditEntry = buildAuditEntry({
      id: 'log-1',
      action,
      fromStatus: 'awaiting_approval',
      toStatus: 'approved',
      outcome: 'allowed',
      actorId: 'user-manager' as Action['createdBy'],
      actorRole: 'manager',
      actorIsMachine: false,
      message: 'approved',
      now: NOW,
      correlationId: 'corr-1',
    });
    expect(JSON.stringify(entry)).not.toContain('overdue');
    expect(entry.parametersHash).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe('executor failure handling', () => {
  it('records a terminal failure when an executor throws', async () => {
    const repository = new InMemoryActionRepository();
    const throwing: ActionExecutor = {
      executorId: 'throwing',
      handles: 'send_reminder',
      execute: () => Promise.reject(new Error('downstream unavailable')),
    };
    const service = new PostgresActionService(
      repository,
      registryWith([throwing]),
      fixedClockAt(NOW),
      createEventBus(),
    );
    const owner = tenantFor(TENANT_A, 'owner', 'user-owner');
    const approver = tenantFor(TENANT_A, 'owner', 'user-approver');

    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'Will fail',
      description: 'The executor throws.',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    await service.approve(approver, action.id);
    const outcome = await service.execute(approver, { id: action.id });

    expect(outcome.executed).toBe(false);
    expect(outcome.action?.status).toBe('failed');
    const entries = await service.listAudit(owner, action.id);
    expect(entries.at(-1)?.toStatus).toBe('failed');
  });

  it('never leaves an action stuck in executing', async () => {
    const repository = new InMemoryActionRepository();
    const throwing: ActionExecutor = {
      executorId: 'throwing',
      handles: 'send_reminder',
      execute: () => Promise.reject(new Error('boom')),
    };
    const service = new PostgresActionService(
      repository,
      registryWith([throwing]),
      fixedClockAt(NOW),
      createEventBus(),
    );
    const owner = tenantFor(TENANT_A, 'owner', 'user-owner');
    const approver = tenantFor(TENANT_A, 'owner', 'user-approver');
    const action = await service.propose(owner, {
      type: 'send_reminder',
      title: 'x',
      description: 'y',
      source: 'manual',
      parameters: reminderParameters(),
    });
    await service.draft(owner, action.id);
    await service.requestApproval(owner, action.id);
    await service.approve(approver, action.id);
    await service.execute(approver, { id: action.id });

    const stored = await service.getById(owner, action.id);
    expect(stored?.status).toBe('failed');
    const retry = await service.execute(approver, { id: action.id });
    expect(retry.executed).toBe(false);
  });
});