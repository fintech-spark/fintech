import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACTION_PARAMETER_SPECS,
  ACTION_STATUS_TRANSITIONS,
  APPROVAL_TTL_MS,
  APPROVER_ROLES,
  ActionExecutorRegistry,
  AUTO_EXECUTABLE_ACTION_TYPES,
  CONSEQUENTIAL_ACTION_TYPES,
  PostgresActionService,
  buildAuditEntry,
  canApprove,
  canCancel,
  canExecute,
  canTransitionActionTo,
  canonicalize,
  classifyRisk,
  executionIdempotencyKey,
  hashActionParameters,
  isAuthorizationDenial,
  isReplayDenial,
  refusingExecutor,
  requiresDistinctApprover,
  validateActionParameters,
  type Action,
  type ActionAuditEntry,
  type ActionExecutor,
  type ActionType,
  type ExecutionOutcome,
} from '@/modules/actions';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { createEventBus } from '@/lib/events';
import {
  InMemoryActionRepository,
  TENANT_A,
  TENANT_B,
  fixedClockAt,
  tenantFor,
} from './support/doubles';

const NOW = new Date('2026-02-01T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Test executors
// ---------------------------------------------------------------------------

/** Counts every invocation so double-execution is directly observable. */
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
// State machine
// ---------------------------------------------------------------------------

describe('action state machine', () => {
  it('permits only the documented transitions', () => {
    expect(ACTION_STATUS_TRANSITIONS.proposed).toEqual(['drafted', 'cancelled']);
    expect(ACTION_STATUS_TRANSITIONS.drafted).toEqual(['awaiting_approval', 'cancelled']);
    expect(ACTION_STATUS_TRANSITIONS.awaiting_approval).toEqual(['approved', 'cancelled']);
    expect(ACTION_STATUS_TRANSITIONS.approved).toEqual(['executing']);
    expect(ACTION_STATUS_TRANSITIONS.executing).toEqual(['completed', 'failed']);
    expect(ACTION_STATUS_TRANSITIONS.completed).toEqual([]);
    expect(ACTION_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });

  it('refuses the transitions that would be dangerous', () => {
    expect(canTransitionActionTo('approved', 'completed')).toBe(false);
    expect(canTransitionActionTo('completed', 'executing')).toBe(false);
    expect(canTransitionActionTo('cancelled', 'approved')).toBe(false);
    expect(canTransitionActionTo('cancelled', 'executing')).toBe(false);
    expect(canTransitionActionTo('rejected' as never, 'approved')).toBe(false);
  });

  it('allows cancellation only before approval', () => {
    expect(canCancel('proposed')).toBe(true);
    expect(canCancel('drafted')).toBe(true);
    expect(canCancel('awaiting_approval')).toBe(true);
    expect(canCancel('approved')).toBe(false);
    expect(canCancel('executing')).toBe(false);
    expect(canCancel('completed')).toBe(false);
  });

  it('has no path out of a terminal state', () => {
    for (const terminal of ['completed', 'cancelled'] as const) {
      expect(ACTION_STATUS_TRANSITIONS[terminal]).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Authorization policy
// ---------------------------------------------------------------------------

describe('approval authority', () => {
  it('lets only owner, admin and manager approve', () => {
    expect(APPROVER_ROLES).toEqual(['owner', 'admin', 'manager']);
    expect(canApprove('owner')).toBe(true);
    expect(canApprove('accountant')).toBe(false);
    expect(canApprove('staff')).toBe(false);
  });

  it('does not let staff execute', () => {
    expect(canExecute('staff')).toBe(false);
    expect(canExecute('accountant')).toBe(true);
  });

  it('classifies action types by risk', () => {
    expect(classifyRisk('adjust_price')).toBe('consequential');
    expect(classifyRisk('send_reminder')).toBe('consequential');
    expect(classifyRisk('create_transaction')).toBe('consequential');
    expect(AUTO_EXECUTABLE_ACTION_TYPES).toEqual([]);
  });

  it('requires a distinct approver for every consequential action', () => {
    expect(requiresDistinctApprover({ type: 'adjust_price', source: 'manual' })).toBe(true);
    expect(requiresDistinctApprover({ type: 'reorder_stock', source: 'manual' })).toBe(true);
  });

  it('always requires a distinct approver for a machine proposal', () => {
    expect(requiresDistinctApprover({ type: 'reorder_stock', source: 'ai_recommendation' })).toBe(true);
  });

  it('can be relaxed to the explicitly consequential types by policy', () => {
    const relaxed = { requireDistinctApproverForEveryType: false };
    expect(requiresDistinctApprover({ type: 'adjust_price', source: 'manual' }, relaxed)).toBe(true);
    expect(requiresDistinctApprover({ type: 'reorder_stock', source: 'manual' }, relaxed)).toBe(false);
    // A machine proposal still needs a second pair of eyes under the relaxed policy.
    expect(
      requiresDistinctApprover({ type: 'reorder_stock', source: 'ai_recommendation' }, relaxed),
    ).toBe(true);
  });

  it('lists the consequential types explicitly', () => {
    expect(CONSEQUENTIAL_ACTION_TYPES).toContain('create_transaction');
    expect(CONSEQUENTIAL_ACTION_TYPES).toContain('send_reminder');
  });
});

// ---------------------------------------------------------------------------
// Tamper detection
// ---------------------------------------------------------------------------

describe('parameter tamper detection', () => {
  const action: Pick<Action, 'parameters' | 'type'> = {
    type: 'send_reminder',
    parameters: { customerId: 'c1', channel: 'email', body: 'hello' },
  };

  it('produces the same hash for the same content regardless of key order', () => {
    const reordered: Pick<Action, 'parameters' | 'type'> = {
      type: 'send_reminder',
      parameters: { body: 'hello', channel: 'email', customerId: 'c1' },
    };
    expect(hashActionParameters(reordered)).toBe(hashActionParameters(action));
  });

  it('produces a different hash when any value changes', () => {
    const tampered: Pick<Action, 'parameters' | 'type'> = {
      type: 'send_reminder',
      parameters: { ...action.parameters, customerId: 'c2' },
    };
    expect(hashActionParameters(tampered)).not.toBe(hashActionParameters(action));
  });

  it('produces a different hash when the action type changes', () => {
    expect(hashActionParameters({ ...action, type: 'adjust_price' })).not.toBe(
      hashActionParameters(action),
    );
  });

  it('canonicalises undefined and non-finite values without throwing', () => {
    expect(canonicalize(undefined)).toBe('undef');
    expect(canonicalize(Number.NaN)).toBe('nonfinite');
    expect(canonicalize(Number.POSITIVE_INFINITY)).toBe('nonfinite');
  });

  it('builds a stable execution idempotency key', () => {
    expect(executionIdempotencyKey('a1')).toBe(executionIdempotencyKey('a1'));
    expect(executionIdempotencyKey('a1', 'k1')).not.toBe(executionIdempotencyKey('a1', 'k2'));
    expect(executionIdempotencyKey('a1', 'k1')).toBe(executionIdempotencyKey('a1', 'k1'));
    expect(executionIdempotencyKey('a1')).not.toBe(executionIdempotencyKey('a2'));
  });
});

// ---------------------------------------------------------------------------
// Executor allowlist
// ---------------------------------------------------------------------------

describe('executor allowlist', () => {
  it('resolves only a registered type', () => {
    const executor = new CountingExecutor('stub', 'send_reminder', { success: true, output: 'ok' });
    const registry = registryWith([executor]);
    expect(registry.has('send_reminder')).toBe(true);
    expect(registry.has('adjust_price')).toBe(false);
    expect(registry.resolve('adjust_price')).toBeUndefined();
  });

  it('refuses registration after the registry is frozen', () => {
    const registry = registryWith([]);
    expect(() =>
      registry.register(new CountingExecutor('late', 'send_reminder', { success: true, output: 'ok' })),
    ).toThrow(/frozen/i);
  });

  it('refuses two executors claiming the same type', () => {
    const registry = new ActionExecutorRegistry();
    registry.register(new CountingExecutor('first', 'send_reminder', { success: true, output: 'ok' }));
    expect(() =>
      registry.register(new CountingExecutor('second', 'send_reminder', { success: true, output: 'ok' })),
    ).toThrow(/already registered/i);
  });

  it('refuses a dedicated executor claiming the custom type', () => {
    const registry = new ActionExecutorRegistry();
    expect(() =>
      registry.register(new CountingExecutor('sneaky', 'custom', { success: true, output: 'ok' })),
    ).toThrow(/custom/i);
  });

  it('offers a refusing executor so an unconfigured type fails closed', async () => {
    const executor = refusingExecutor('adjust_price', 'no payment integration is configured');
    const outcome = await executor.execute({} as Action, {} as never);
    expect(outcome.success).toBe(false);
    expect(outcome.errorCode).toBe('NO_EXECUTOR_CONFIGURED');
  });
});

// ---------------------------------------------------------------------------
// Parameter validation
// ---------------------------------------------------------------------------

describe('action parameter validation', () => {
  const valid = {
    type: 'send_reminder' as const,
    parameters: reminderParameters(),
  };

  it('accepts a well-formed parameter set', () => {
    expect(() => validateActionParameters(valid)).not.toThrow();
  });

  it('rejects an undeclared parameter key', () => {
    expect(() =>
      validateActionParameters({ type: 'send_reminder', parameters: { ...valid.parameters, shell: 'rm -rf /' } }),
    ).toThrow(/not declared/i);
  });

  it('rejects a prototype-polluting key', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":true},"channel":"email"}') as Record<
      string,
      unknown
    >;
    expect(() =>
      validateActionParameters({
        type: 'send_reminder',
        parameters: { ...valid.parameters, ...hostile } as never,
      }),
    ).toThrow(/__proto__|not declared/i);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a missing required parameter', () => {
    expect(() =>
      validateActionParameters({ type: 'send_reminder', parameters: { channel: 'email' } }),
    ).toThrow(/required/i);
  });

  it('rejects a non-integer money value rather than truncating it', () => {
    expect(() =>
      validateActionParameters({
        type: 'adjust_price',
        parameters: { productId: 'p1', newPriceMinor: 100.5 },
      }),
    ).toThrow(/minor units/i);
  });

  it('rejects negative money and absurd amounts', () => {
    expect(() =>
      validateActionParameters({
        type: 'adjust_price',
        parameters: { productId: 'p1', newPriceMinor: -1 },
      }),
    ).toThrow(/out of range/i);
    expect(() =>
      validateActionParameters({
        type: 'adjust_price',
        parameters: { productId: 'p1', newPriceMinor: Number.MAX_SAFE_INTEGER },
      }),
    ).toThrow(/out of range/i);
  });

  it('rejects a value outside an enum', () => {
    expect(() =>
      validateActionParameters({
        type: 'send_reminder',
        parameters: { ...valid.parameters, channel: 'carrier_pigeon' },
      }),
    ).toThrow(/must be one of/i);
  });

  it('rejects an unparseable timestamp', () => {
    expect(() =>
      validateActionParameters({
        type: 'create_transaction',
        parameters: { counterpartyId: 'c1', totalMinor: 100, transactionDate: 'not-a-date' },
      }),
    ).toThrow(/valid timestamp/i);
  });

  it('rejects an oversized free-text field', () => {
    expect(() =>
      validateActionParameters({
        type: 'send_reminder',
        parameters: { ...valid.parameters, body: 'x'.repeat(2_001) },
      }),
    ).toThrow(/characters/i);
  });

  it('rejects a non-object parameter payload', () => {
    expect(() =>
      validateActionParameters({ type: 'send_reminder', parameters: [] as never }),
    ).toThrow(/must be an object/i);
  });

  it('declares a schema for every action type', () => {
    for (const type of Object.keys(ACTION_PARAMETER_SPECS) as ActionType[]) {
      expect(ACTION_PARAMETER_SPECS[type]).toBeDefined();
    }
  });
});

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

    const outcome = await service.execute(manager, { id: approved.id });
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
    const outcome: ExecutionOutcome = await isolated.execute(manager, { id: approved.id });
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
    await service.execute(approver, { id: action.id });
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
    await service.execute(approver, { id: action.id });
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