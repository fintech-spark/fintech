import { ValidationError } from '@/lib/errors';
import type { TenantContext } from '@/lib/types';
import type { Action, ActionType } from './types';

/**
 * Executor allowlist.
 *
 * Execution capability lives behind an explicit registry keyed by action type.
 * An unregistered type fails closed. There is no dynamic dispatch, no string
 * resolution into a module, no `eval`, no `Function`, no shell and no HTTP fetch
 * driven by an action's parameters. An executor can only be added by code that
 * a reviewer can see in the diff.
 *
 * The `actions` module may not import any sibling module (`MODULE_DEPENDENCIES`
 * in `lib/boundaries.ts` declares `actions: []`), so nothing here may reach into
 * the analytics layer, the database client, or any other domain. Consequences that
 * are enforced rather than documented:
 *
 *   * Executors receive the narrow capability they need through `ExecutorContext`
 *     instead of a database handle. An executor that genuinely must write to a
 *     ledger table belongs to that table's module and is wired in by the
 *     composition root.
 *   * The integer checks below use `Number.isSafeInteger` directly rather than
 *     importing a shared helper, because importing one would be a forbidden
 *     dependency. Duplicating a one-line language builtin is the cheaper of the
 *     two evils; duplicating a domain abstraction would not be.
 *
 * `tests/intelligence/sql-and-boundaries.test.ts` fails the build if a sibling
 * import is ever added here.
 */

export interface ExecutorContext {
  readonly tenant: TenantContext;
  readonly correlationId: string;
  /** Structured, PII-free logger. Never receives action parameters verbatim. */
  readonly logger: ActionLogger;
  /** True when the action originated from a machine proposal. */
  readonly machineProposed: boolean;
}

export interface ActionLogger {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface ExecutorOutcome {
  readonly success: boolean;
  /** Safe, user-presentable summary. Never contains secrets or raw payloads. */
  readonly output: string;
  readonly affectedResources?: readonly { readonly type: string; readonly id: string }[];
  /** Typed error code when `success` is false. */
  readonly errorCode?: string;
}

export interface ActionExecutor {
  /** Stable id recorded in the audit trail. */
  readonly executorId: string;
  /** The single action type this executor handles. */
  readonly handles: ActionType;
  execute(action: Action, context: ExecutorContext): Promise<ExecutorOutcome>;
}

/**
 * Registry of permitted executors.
 *
 * Built once at composition time from an explicit list. `register` is refused
 * after `freeze()`, so no request path can add an executor at runtime — a
 * plausible route to "the model picks its own capability" is closed structurally.
 */
export class ActionExecutorRegistry {
  private readonly executors = new Map<ActionType, ActionExecutor>();
  private frozen = false;

  register(executor: ActionExecutor): this {
    if (this.frozen) {
      throw new Error(
        `Executor registry is frozen; "${executor.executorId}" cannot be registered at runtime.`,
      );
    }
    if (executor.handles === 'custom') {
      throw new Error(
        'A dedicated executor cannot claim the "custom" action type. Custom actions require an ' +
          'explicit per-deployment executor so their behaviour is always reviewable.',
      );
    }
    if (this.executors.has(executor.handles)) {
      throw new Error(`An executor for "${executor.handles}" is already registered.`);
    }
    this.executors.set(executor.handles, executor);
    return this;
  }

  freeze(): this {
    this.frozen = true;
    return this;
  }

  /** Returns the executor for a type, or `undefined` when the type is not allowed. */
  resolve(type: ActionType): ActionExecutor | undefined {
    return this.executors.get(type);
  }

  has(type: ActionType): boolean {
    return this.executors.has(type);
  }

  types(): ReadonlySet<ActionType> {
    return new Set(this.executors.keys());
  }

  get size(): number {
    return this.executors.size;
  }
}

// ---------------------------------------------------------------------------
// Parameter validation
//
// Executors receive untrusted input. `parameters` originates from a model
// proposal, a document field or a merchant's free text, so it is validated
// structurally before any executor sees it. Validation is per action type: an
// allowlist of keys with declared kinds, no arbitrary nesting, no prototype keys.
// ---------------------------------------------------------------------------

type ParamKind = 'string' | 'integer' | 'money' | 'date' | 'boolean' | 'enum';

interface ParamSpec {
  readonly kind: ParamKind;
  readonly maxLength?: number;
  readonly values?: readonly string[];
  readonly required?: boolean;
}

const MAX_STRING_LENGTH = 2_000;
const MAX_MONEY_MINOR = 100_000_000_00;

/**
 * Parameter contracts per action type.
 *
 * Declaring them here rather than inside each executor means the schema is
 * reviewable in one place, and a new parameter cannot be added without also
 * declaring its kind and bound.
 */
export const ACTION_PARAMETER_SPECS: Readonly<Record<ActionType, Readonly<Record<string, ParamSpec>>>> = {
  // Every type accepts a reserved `idempotencyKey`. It is a transport concern, not
  // a business parameter: it is stored separately in the `idempotency_key` column
  // and is never handed to an executor as a parameter.
  adjust_price: {
    idempotencyKey: { kind: 'string', maxLength: 255 },
    productId: { kind: 'string', maxLength: 128, required: true },
    newPriceMinor: { kind: 'money', required: true },
  },
  reorder_stock: {
    idempotencyKey: { kind: 'string', maxLength: 255 },
    productId: { kind: 'string', maxLength: 128, required: true },
    quantity: { kind: 'integer', required: true },
    supplierId: { kind: 'string', maxLength: 128 },
  },
  send_reminder: {
    idempotencyKey: { kind: 'string', maxLength: 255 },
    customerId: { kind: 'string', maxLength: 128, required: true },
    channel: { kind: 'enum', values: ['email', 'sms', 'whatsapp'], required: true },
    body: { kind: 'string', maxLength: MAX_STRING_LENGTH, required: true },
    amountMinor: { kind: 'money' },
  },
  change_supplier: {
    idempotencyKey: { kind: 'string', maxLength: 255 },
    productId: { kind: 'string', maxLength: 128, required: true },
    supplierId: { kind: 'string', maxLength: 128, required: true },
  },
  reduce_expense: {
    idempotencyKey: { kind: 'string', maxLength: 255 },
    expenseId: { kind: 'string', maxLength: 128 },
    category: { kind: 'string', maxLength: 64 },
    reductionBps: { kind: 'integer', required: true },
  },
  create_transaction: {
    idempotencyKey: { kind: 'string', maxLength: 255 },
    counterpartyId: { kind: 'string', maxLength: 128, required: true },
    totalMinor: { kind: 'money', required: true },
    transactionDate: { kind: 'date', required: true },
  },
  custom: {},
};

/**
 * Validates an action's parameters against its declared contract.
 *
 * Rejects unknown keys, prototype-polluting keys, wrong types, oversized strings,
 * negative or non-integer money, unparseable dates and out-of-range integers.
 * Throws `ValidationError` on the first violation so nothing partial is passed on.
 */
export function validateActionParameters(action: Pick<Action, 'type' | 'parameters'>): void {
  const spec = ACTION_PARAMETER_SPECS[action.type];
  if (spec === undefined) {
    throw new ValidationError(`Unsupported action type "${action.type}".`);
  }
  const parameters = action.parameters;
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    throw new ValidationError('Action parameters must be an object.');
  }

  for (const key of Object.keys(parameters)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new ValidationError(`Action parameter "${key}" is not permitted.`);
    }
    if (!(key in spec)) {
      throw new ValidationError(`Action parameter "${key}" is not declared for type "${action.type}".`);
    }
  }

  for (const [key, declared] of Object.entries(spec)) {
    const value = parameters[key];
    if (value === undefined || value === null) {
      if (declared.required === true) {
        throw new ValidationError(`Action parameter "${key}" is required for type "${action.type}".`);
      }
      continue;
    }
    assertParamKind(key, value, declared);
  }
}

function assertParamKind(key: string, value: unknown, spec: ParamSpec): void {
  switch (spec.kind) {
    case 'string': {
      if (typeof value !== 'string') {
        throw new ValidationError(`Action parameter "${key}" must be a string.`);
      }
      if (value.length === 0 || value.length > (spec.maxLength ?? MAX_STRING_LENGTH)) {
        throw new ValidationError(
          `Action parameter "${key}" must be between 1 and ${spec.maxLength ?? MAX_STRING_LENGTH} characters.`,
        );
      }
      return;
    }
    case 'integer': {
      if (!Number.isSafeInteger(value)) {
        throw new ValidationError(`Action parameter "${key}" must be a safe integer.`);
      }
      if ((value as number) < 0 || (value as number) > MAX_MONEY_MINOR) {
        throw new ValidationError(`Action parameter "${key}" is out of range.`);
      }
      return;
    }
    case 'money': {
      if (!Number.isSafeInteger(value)) {
        throw new ValidationError(
          `Action parameter "${key}" must be an integer count of minor units.`,
        );
      }
      if ((value as number) < 0 || (value as number) > MAX_MONEY_MINOR) {
        throw new ValidationError(`Action parameter "${key}" is out of range.`);
      }
      return;
    }
    case 'date': {
      const parsed = new Date(value as string);
      if (Number.isNaN(parsed.getTime())) {
        throw new ValidationError(`Action parameter "${key}" must be a valid timestamp.`);
      }
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        throw new ValidationError(`Action parameter "${key}" must be a boolean.`);
      }
      return;
    }
    case 'enum': {
      if (typeof value !== 'string' || !(spec.values ?? []).includes(value)) {
        throw new ValidationError(
          `Action parameter "${key}" must be one of: ${(spec.values ?? []).join(', ')}.`,
        );
      }
      return;
    }
  }
}

/**
 * An executor that always refuses.
 *
 * Useful when a deployment has not wired a real capability yet: the action type
 * is recognised, so the failure is an explicit "not configured" rather than a
 * silent no-op or, worse, an unexpected generic path.
 */
export function refusingExecutor(type: ActionType, reason: string): ActionExecutor {
  return {
    executorId: `refusing:${type}:${reason}`,
    handles: type,
    execute: () =>
      Promise.resolve({
        success: false,
        output: `Not executed: ${reason}.`,
        errorCode: 'NO_EXECUTOR_CONFIGURED',
      }),
  };
}

const STANDARD_ACTION_TYPES: readonly Exclude<ActionType, 'custom'>[] = [
  'adjust_price',
  'reorder_stock',
  'send_reminder',
  'change_supplier',
  'reduce_expense',
  'create_transaction',
];

/**
 * The registry is intentionally explicit, but no production side-effect
 * adapter is wired yet. Refusing is safer than recording a false success for
 * a price change, message, reorder, or ledger mutation.
 */
export const STANDARD_ACTION_EXECUTORS: readonly ActionExecutor[] = STANDARD_ACTION_TYPES.map(
  (type) => refusingExecutor(type, 'the production capability is not configured'),
);

export function createDefaultActionExecutorRegistry(): ActionExecutorRegistry {
  const registry = new ActionExecutorRegistry();
  for (const executor of STANDARD_ACTION_EXECUTORS) {
    registry.register(executor);
  }
  return registry.freeze();
}
