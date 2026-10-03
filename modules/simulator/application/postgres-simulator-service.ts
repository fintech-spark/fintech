import { AuthorizationError, ValidationError } from '@/lib/errors';
import type { Clock } from '@/lib/clock';
import {
  asBusinessId,
  type BusinessId,
  type PaginatedResult,
  type TenantContext,
} from '@/lib/types';
import { previousEquivalentPeriod, validatePeriod, type AnalyticsService } from '@/modules/analytics';
import { randomUUID } from 'node:crypto';
import {
  BASELINE_ASSUMPTIONS,
  runScenarioEngine,
  type EngineResult,
} from '../domain/rules';
import type {
  RunScenarioInput,
  Scenario,
  ScenarioFilters,
  ScenarioParameter,
  ScenarioSnapshot,
  ScenarioStatus,
} from '../domain/types';

/**
 * Application contract for the what-if simulator.
 *
 * Every method here is read-only with respect to business data. The only write
 * is to the `scenarios` table, which holds the hypothetical result itself; no
 * product, price, stock, invoice or payment record is reachable from this
 * interface.
 */
export interface SimulatorService {
  /** Run a scenario against the merchant's current period and persist the result. */
  runScenario(
    ctx: TenantContext,
    period: { from: Date; to: Date },
    input: RunScenarioInput,
  ): Promise<Scenario>;

  getById(ctx: TenantContext, scenarioId: string): Promise<Scenario | null>;
  list(ctx: TenantContext, filters: ScenarioFilters): Promise<PaginatedResult<Scenario>>;

  /**
   * Recompute a stored scenario's parameters against current data.
   * Returns a fresh result; the stored scenario is left untouched.
   */
  recompute(ctx: TenantContext, scenarioId: string): Promise<Scenario | null>;
}

/**
 * Read model for scenarios.
 *
 * Scenarios are immutable once written. There is no update and no delete: a
 * stored simulation is a record of what was asked and what was calculated, and
 * silently editing it would make the audit trail worthless.
 */
export interface ScenarioRepository {
  save(scenario: Scenario): Promise<Scenario>;
  findById(businessId: BusinessId, id: string): Promise<Scenario | null>;
  list(businessId: BusinessId, filters: Required<Pick<ScenarioFilters, 'page' | 'limit'>> & { status?: ScenarioStatus }): Promise<PaginatedResult<Scenario>>;
}

/** Validation limits for a scenario name, matching the column's practical size. */
const MAX_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 5_000;
const MAX_PARAMETERS = 10;

/**
 * Simulator service.
 *
 * The service's only jobs are: validate input, read the authoritative baseline
 * from analytics, hand both to the pure engine, and persist the hypothetical
 * result. It performs no arithmetic of its own, which is what guarantees the
 * simulation cannot disagree with the dashboard it is based on.
 */
export class PostgresSimulatorService implements SimulatorService {
  constructor(
    private readonly repository: ScenarioRepository,
    private readonly analytics: AnalyticsService,
    private readonly clock: Clock,
  ) {}

  async runScenario(
    ctx: TenantContext,
    period: { from: Date; to: Date },
    input: RunScenarioInput,
  ): Promise<Scenario> {
    const validatedPeriod = validatePeriod(period);
    const parameters = validateParameters(input.parameters);
    const name = validateName(input.name);
    const description = validateDescription(input.description);

    const snapshot = await this.analytics.getSnapshot(ctx, validatedPeriod);
    const baseline = toScenarioSnapshot(snapshot);
    const parametersWithCosts = await this.attachProductCosts(ctx, parameters);
    const engine = runScenarioEngine(baseline, parametersWithCosts);

    const scenario: Scenario = {
      id: randomUUID(),
      businessId: ctx.businessId,
      name,
      ...(description === undefined ? {} : { description }),
      parameters: parametersWithCosts,
      baseline,
      projected: engine.projected,
      comparison: engine.comparison,
      status: engine.rejections.length > 0 ? 'draft' : 'calculated',
      createdAt: this.clock.now(),
      currency: snapshot.currency,
      periodStart: validatedPeriod.from,
      periodEnd: validatedPeriod.to,
      assumptions: [...BASELINE_ASSUMPTIONS, ...engine.assumptions],
      rejections: engine.rejections,
      quality: snapshot.quality,
      isProjection: true,
      cashTiming: engine.cashTiming,
    };

    return this.repository.save(scenario);
  }

  async getById(ctx: TenantContext, scenarioId: string): Promise<Scenario | null> {
    assertOpaqueId(scenarioId, 'scenarioId');
    return this.repository.findById(ctx.businessId, scenarioId);
  }

  async list(ctx: TenantContext, filters: ScenarioFilters): Promise<PaginatedResult<Scenario>> {
    return this.repository.list(ctx.businessId, {
      page: normalisePage(filters.page),
      limit: normaliseLimit(filters.limit),
      status: filters.status,
    });
  }

  /**
   * Re-runs a stored scenario's parameters against the merchant's current data.
   *
   * Produces a new scenario and leaves the stored one alone, so the historical
   * record of what a merchant was shown at the time is preserved.
   */
  async recompute(ctx: TenantContext, scenarioId: string): Promise<Scenario | null> {
    assertOpaqueId(scenarioId, 'scenarioId');
    const stored = await this.repository.findById(ctx.businessId, scenarioId);
    if (stored === null) return null;
    return this.runScenario(ctx, trailingWindow(stored, this.clock.now()), {
      name: stored.name,
      parameters: stored.parameters,
    });
  }

  /**
   * Attaches each product's recorded cost price to an `inventory_order`.
   *
   * Required because an order cannot be priced without one. The cost is read
   * through the tenant-scoped analytics service and attached to the parameter's
   * `currentValue`, which is what `inventoryOutlay` multiplies by quantity.
   * A product that cannot be read leaves the parameter rejected rather than
   * silently costing the order at zero.
   */
  private async attachProductCosts(
    ctx: TenantContext,
    parameters: readonly ScenarioParameter[],
  ): Promise<ScenarioParameter[]> {
    const resolved: ScenarioParameter[] = [];
    for (const parameter of parameters) {
      if (parameter.type !== 'inventory_order' || parameter.targetId === undefined) {
        resolved.push(parameter);
        continue;
      }
      assertOpaqueId(parameter.targetId, 'targetId');
      const products = await this.analytics.getProducts(ctx);
      const product = products.find((candidate) => candidate.id === parameter.targetId);
      if (!product) {
        throw new AuthorizationError('The referenced product is not available for this business.');
      }
      resolved.push({
        ...parameter,
        currentValue: product.costPriceMinor,
        targetName: product.name,
      });
    }
    return resolved;
  }
}

// ---------------------------------------------------------------------------
// Baseline projection
// ---------------------------------------------------------------------------

/**
 * Converts an authoritative snapshot into the simulator's baseline shape.
 *
 * Carries gross revenue and discounts alongside net revenue so a discount
 * scenario can be computed from the recorded discount rate rather than
 * re-deriving it.
 */
export function toScenarioSnapshot(snapshot: {
  revenue: { amount: number };
  cogs: { amount: number };
  grossProfit: { amount: number };
  grossMarginBps: number;
  operatingExpenses: { amount: number };
  netProfit: { amount: number };
  netMarginBps: number;
  revenueRecognition: { grossRevenue: { amount: number }; discounts: { amount: number }; saleCount: number; quantitySold: number };
}): ScenarioSnapshot {
  return {
    revenue: snapshot.revenue.amount,
    cogs: snapshot.cogs.amount,
    grossProfit: snapshot.grossProfit.amount,
    grossMarginBps: snapshot.grossMarginBps,
    operatingExpenses: snapshot.operatingExpenses.amount,
    netProfit: snapshot.netProfit.amount,
    netMarginBps: snapshot.netMarginBps,
    grossRevenue: snapshot.revenueRecognition.grossRevenue.amount,
    discounts: snapshot.revenueRecognition.discounts.amount,
    quantitySold: snapshot.revenueRecognition.quantitySold,
    saleCount: snapshot.revenueRecognition.saleCount,
  };
}

/**
 * The window a recomputation runs against.
 *
 * A window of the same length as the original period, ending now. Using the
 * original dates would replay a stale baseline; using "now" alone would produce a
 * zero-length period with nothing to compare.
 */
export function trailingWindow(
  stored: { periodStart: Date; periodEnd: Date },
  now: Date,
): { from: Date; to: Date } {
  const lengthMs = Math.max(
    stored.periodEnd.getTime() - stored.periodStart.getTime(),
    MIN_RECOMPUTE_WINDOW_MS,
  );
  return { from: new Date(now.getTime() - lengthMs), to: now };
}

/** Shortest window a recomputation may use, so the baseline is never empty. */
export const MIN_RECOMPUTE_WINDOW_MS = 86_400_000;

/** Exported for tests that assert engine/service parity. */
export { runScenarioEngine };
export type { EngineResult };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PARAMETER_TYPES: readonly ScenarioParameter['type'][] = [
  'price_change',
  'quantity_change',
  'discount_change',
  'cost_change',
  'expense_change',
  'payment_timing',
  'inventory_order',
];

const PARAMETER_UNITS: readonly ScenarioParameter['unit'][] = [
  'amount',
  'percentage',
  'quantity',
  'days',
];

/**
 * Validates a parameter list before any data is read.
 *
 * Rejecting here means a malformed request never reaches the analytics layer,
 * so a hostile request cannot induce a database read at all.
 */
export function validateParameters(
  parameters: readonly ScenarioParameter[],
): ScenarioParameter[] {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    throw new ValidationError('A scenario needs at least one parameter.');
  }
  if (parameters.length > MAX_PARAMETERS) {
    throw new ValidationError(`A scenario accepts at most ${MAX_PARAMETERS} parameters.`);
  }
  return parameters.map((parameter, index) => {
    if (!PARAMETER_TYPES.includes(parameter.type)) {
      throw new ValidationError(`Parameter ${index} has unsupported type "${parameter.type}".`);
    }
    if (!PARAMETER_UNITS.includes(parameter.unit)) {
      throw new ValidationError(`Parameter ${index} has unsupported unit "${parameter.unit}".`);
    }
    if (!Number.isFinite(parameter.currentValue) || !Number.isFinite(parameter.newValue)) {
      throw new ValidationError(`Parameter ${index} must have finite numeric values.`);
    }
    if (parameter.targetId !== undefined) {
      assertOpaqueId(parameter.targetId, `parameters[${index}].targetId`);
    }
    if (parameter.targetName !== undefined && typeof parameter.targetName !== 'string') {
      throw new ValidationError(`Parameter ${index} targetName must be a string.`);
    }
    return parameter;
  });
}

function validateName(name: string): string {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('A scenario name is required.');
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`A scenario name may be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return name.trim();
}

function validateDescription(description?: string): string | undefined {
  if (description === undefined) return undefined;
  if (typeof description !== 'string') {
    throw new ValidationError('Scenario description must be a string.');
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ValidationError(
      `Scenario description may be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return description;
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

export { previousEquivalentPeriod, asBusinessId, type ScenarioStatus };