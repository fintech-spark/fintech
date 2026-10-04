import { describe, expect, it } from 'vitest';
import { hasPermission } from '@/lib/http/auth-context';
import type { UserRole } from '@/lib/types';
import {
  ACTION_PARAMETER_SPECS,
  ACTION_STATUS_TRANSITIONS,
  APPROVER_ROLES,
  ActionExecutorRegistry,
  AUTO_EXECUTABLE_ACTION_TYPES,
  CONSEQUENTIAL_ACTION_TYPES,
  canApprove,
  canCancel,
  canExecute,
  canTransitionActionTo,
  canonicalize,
  classifyRisk,
  executionIdempotencyKey,
  hashActionParameters,
  refusingExecutor,
  requiresDistinctApprover,
  validateActionParameters,
  type Action,
  type ActionExecutor,
  type ActionType,
} from '@/modules/actions';

/** Counts every invocation so duplicate execution is directly observable. */
class CountingExecutor implements ActionExecutor {
  invocations = 0;
  constructor(
    readonly executorId: string,
    readonly handles: ActionType,
  ) {}
  execute(): Promise<{ success: boolean; output: string; executorId: string }> {
    this.invocations += 1;
    return Promise.resolve({ success: true, output: 'ok', executorId: this.executorId });
  }
}

function reminderParameters() {
  return {
    customerId: 'customer-1',
    channel: 'email',
    body: 'Your payment is overdue. Please settle the outstanding balance.',
  };
}

function registryWith(executors: ActionExecutor[]): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry();
  for (const executor of executors) registry.register(executor);
  return registry.freeze();
}

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

  it('lets only owner execute', () => {
    expect(canExecute('owner')).toBe(true);
    expect(canExecute('admin')).toBe(false);
    expect(canExecute('manager')).toBe(false);
    expect(canExecute('accountant')).toBe(false);
    expect(canExecute('staff')).toBe(false);
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
    const executor = new CountingExecutor('stub', 'send_reminder');
    const registry = registryWith([executor]);
    expect(registry.has('send_reminder')).toBe(true);
    expect(registry.has('adjust_price')).toBe(false);
    expect(registry.resolve('adjust_price')).toBeUndefined();
  });

  it('refuses registration after the registry is frozen', () => {
    const registry = registryWith([]);
    expect(() =>
      registry.register(new CountingExecutor('late', 'send_reminder')),
    ).toThrow(/frozen/i);
  });

  it('refuses two executors claiming the same type', () => {
    const registry = new ActionExecutorRegistry();
    registry.register(new CountingExecutor('first', 'send_reminder'));
    expect(() =>
      registry.register(new CountingExecutor('second', 'send_reminder')),
    ).toThrow(/already registered/i);
  });

  it('refuses a dedicated executor claiming the custom type', () => {
    const registry = new ActionExecutorRegistry();
    expect(() =>
      registry.register(new CountingExecutor('sneaky', 'custom')),
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

describe('createDefaultActionExecutorRegistry', () => {
  it('registers all standard action types and freezes the registry', async () => {
    const { createDefaultActionExecutorRegistry, STANDARD_ACTION_EXECUTORS } = await import('@/modules/actions');
    const registry = createDefaultActionExecutorRegistry();

    expect(STANDARD_ACTION_EXECUTORS.length).toBe(6);
    expect(registry.size).toBe(6);
    expect(registry.has('adjust_price')).toBe(true);
    expect(registry.has('reorder_stock')).toBe(true);
    expect(registry.has('send_reminder')).toBe(true);
    expect(registry.has('change_supplier')).toBe(true);
    expect(registry.has('reduce_expense')).toBe(true);
    expect(registry.has('create_transaction')).toBe(true);

    // Verify it is frozen against runtime mutation
    expect(() =>
      registry.register({
        executorId: 'malicious:runtime_injected',
        handles: 'adjust_price',
        execute: async () => ({ success: true, output: 'hacked' }),
      }),
    ).toThrow(/frozen/i);

    // Verify execution for an executor
    const reminderExecutor = registry.resolve('send_reminder');
    expect(reminderExecutor).toBeDefined();
    const outcome = await reminderExecutor!.execute(
      {
        id: 'act-1' as never,
        businessId: 'biz-1' as never,
        type: 'send_reminder',
        title: 'Send reminder',
        description: 'Overdue invoice reminder',
        status: 'approved',
        source: 'manual',
        createdBy: 'usr-1' as never,
        currency: 'INR',
        parameters: { customerId: 'cust-1', channel: 'email', body: 'Please pay invoice' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        tenant: { businessId: 'biz-1' as never, userId: 'usr-1' as never, role: 'owner', correlationId: 'c1' },
        correlationId: 'c1',
        logger: { debug: () => {}, info: () => {}, warn: () => {} },
        machineProposed: false,
      },
    );
    expect(outcome.success).toBe(true);
    expect(outcome.output).toContain('Payment reminder');
  });
});

describe('role matrix consistency', () => {
  const allRoles: UserRole[] = ['owner', 'admin', 'manager', 'accountant', 'staff'];

  it('aligns canExecute with auth-context actions:execute permission', () => {
    for (const role of allRoles) {
      expect(canExecute(role)).toBe(hasPermission(role, 'actions:execute'));
    }
  });

  it('aligns canApprove with auth-context actions:approve permission', () => {
    for (const role of allRoles) {
      expect(canApprove(role)).toBe(hasPermission(role, 'actions:approve'));
    }
  });
});
