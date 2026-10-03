import {
  applyBpsToMinorUnits,
  clamp,
  ratioBps,
  roundHalfAwayFromZero,
} from '@/modules/analytics';
import type {
  ParameterType,
  ScenarioAssumption,
  ScenarioCashTiming,
  ScenarioComparison,
  ScenarioParameter,
  ScenarioRejection,
  ScenarioSnapshot,
} from './types';

// ---------------------------------------------------------------------------
// What-if arithmetic. Pure functions, no clock, no I/O, no repository.
// ---------------------------------------------------------------------------

/** Largest absolute change a `percentage` parameter may express, in bps (+/-100%). */
export const MAX_PERCENTAGE_CHANGE_BPS = 10_000;

/** Largest quantity an `inventory_order` parameter may request. */
export const MAX_ORDER_QUANTITY = 1_000_000;

/** Largest number of days a `payment_timing` shift may request. */
export const MAX_TIMING_SHIFT_DAYS = 365;

/**
 * Validates one parameter's bounds.
 *
 * Percentage changes are capped at +/-100% because a larger "change" is not a
 * what-if, it is a different business. Non-percentage values must be
 * non-negative, so a scenario can never propose negative money or stock.
 */
export function validateParameterBounds(param: ScenarioParameter): boolean {
  if (!Number.isFinite(param.currentValue) || !Number.isFinite(param.newValue)) return false;
  if (param.unit === 'percentage') {
    const changeBps = Math.abs(param.newValue - param.currentValue);
    return Number.isInteger(changeBps) && changeBps <= MAX_PERCENTAGE_CHANGE_BPS;
  }
  if (param.unit === 'days') {
    return (
      param.newValue >= 0 &&
      param.newValue <= MAX_TIMING_SHIFT_DAYS &&
      Number.isInteger(param.newValue)
    );
  }
  if (param.unit === 'quantity') {
    return param.newValue >= 0 && param.newValue <= MAX_ORDER_QUANTITY && Number.isFinite(param.newValue);
  }
  return param.newValue >= 0 && Number.isFinite(param.newValue);
}

/** Signed change of a parameter, in its own unit. */
export function parameterChangeBps(param: ScenarioParameter): number {
  return roundHalfAwayFromZero(param.newValue - param.currentValue);
}

// ---------------------------------------------------------------------------
// Baseline construction
// ---------------------------------------------------------------------------

export const EMPTY_SNAPSHOT: ScenarioSnapshot = {
  revenue: 0,
  cogs: 0,
  grossProfit: 0,
  grossMarginBps: 0,
  operatingExpenses: 0,
  netProfit: 0,
  netMarginBps: 0,
  grossRevenue: 0,
  discounts: 0,
  quantitySold: 0,
  saleCount: 0,
};

/** Recomputes every derived figure so a snapshot is never left inconsistent. */
export function normaliseSnapshot(input: Partial<ScenarioSnapshot>): ScenarioSnapshot {
  const revenue = input.revenue ?? 0;
  const cogs = input.cogs ?? 0;
  const grossProfit = revenue - cogs;
  const operatingExpenses = input.operatingExpenses ?? 0;
  const netProfit = grossProfit - operatingExpenses;
  return {
    revenue,
    cogs,
    grossProfit,
    grossMarginBps: ratioBps(grossProfit, revenue) ?? 0,
    operatingExpenses,
    netProfit,
    netMarginBps: ratioBps(netProfit, revenue) ?? 0,
    grossRevenue: input.grossRevenue ?? revenue,
    discounts: input.discounts ?? 0,
    quantitySold: input.quantitySold ?? 0,
    saleCount: input.saleCount ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Individual transformations
//
// Each transformation states, in an assumption, exactly what it holds constant.
// Modelling a price rise as pure revenue uplift with unchanged unit volume is a
// deliberate simplification: the schema holds no elasticity and inventing one
// would be a fabricated forecast.
// ---------------------------------------------------------------------------

export function applyPriceChange(currentRevenue: number, changeBps: number): number {
  return roundHalfAwayFromZero(currentRevenue * (1 + changeBps / 10_000));
}

export function applyCostChange(currentCogs: number, changeBps: number): number {
  return roundHalfAwayFromZero(currentCogs * (1 + changeBps / 10_000));
}

/**
 * Revenue and cost both scale with volume.
 * Unit economics are unchanged, so margin is unchanged: a volume-only scenario
 * should never appear to improve margin.
 */
function applyVolumeChange(
  snapshot: ScenarioSnapshot,
  changeBps: number,
): { revenue: number; cogs: number } {
  return {
    revenue: applyPriceChange(snapshot.revenue, changeBps),
    cogs: applyCostChange(snapshot.cogs, changeBps),
  };
}

/**
 * Net revenue under a new discount rate.
 *
 * The discount is deducted from gross revenue, so the result is what the merchant
 * would actually retain: `grossRevenue - (grossRevenue * rate)`. Returning the
 * discount amount here instead would collapse revenue to the size of the discount,
 * which is the opposite of the intended comparison.
 */
function applyDiscountChange(snapshot: ScenarioSnapshot, newRateBps: number): number {
  const rate = clamp(newRateBps, 0, MAX_PERCENTAGE_CHANGE_BPS);
  const discount = applyBpsToMinorUnits(snapshot.grossRevenue, rate);
  return Math.max(0, snapshot.grossRevenue - discount);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface EngineResult {
  readonly projected: ScenarioSnapshot;
  readonly comparison: ScenarioComparison;
  readonly assumptions: readonly ScenarioAssumption[];
  readonly rejections: readonly ScenarioRejection[];
  readonly cashTiming: ScenarioCashTiming;
}

/**
 * Runs one scenario.
 *
 * Parameters are applied in the order given and each affects the running
 * snapshot, so a price change followed by a volume change compounds. That
 * ordering is part of the contract and is recorded in the assumptions so the
 * result is reproducible.
 */
export function runScenarioEngine(
  baseline: ScenarioSnapshot,
  parameters: readonly ScenarioParameter[],
): EngineResult {
  const assumptions: ScenarioAssumption[] = [];
  const rejections: ScenarioRejection[] = [];
  let projected = normaliseSnapshot(baseline);
  let upfrontOutlayMinor = 0;

  parameters.forEach((parameter, index) => {
    if (!validateParameterBounds(parameter)) {
      rejections.push({
        parameterIndex: index,
        parameterType: parameter.type,
        reason: 'parameter_out_of_bounds',
        explanation:
          `A ${parameter.unit} change from ${parameter.currentValue} to ${parameter.newValue} is ` +
          'outside the supported range.',
      });
      return;
    }
    const applied = applyParameter(projected, parameter, index);
    projected = applied.snapshot;
    upfrontOutlayMinor += applied.upfrontOutlayMinor;
    assumptions.push(...applied.assumptions);
  });

  const normalizedBaseline = normaliseSnapshot(baseline);
  return {
    projected,
    comparison: compareSnapshots(normalizedBaseline, projected),
    assumptions,
    rejections,
    cashTiming: {
      upfrontOutlayMinor,
      netCashDeltaMinor: projected.revenue - normalizedBaseline.revenue - upfrontOutlayMinor,
      affectsProfitAndLoss: parameters.some((parameter) => AFFECTS_PL[parameter.type] === true),
    },
  };
}

/** Parameter types that move profit and loss. */
const AFFECTS_PL: Readonly<Record<ParameterType, boolean>> = {
  price_change: true,
  quantity_change: true,
  discount_change: true,
  cost_change: true,
  expense_change: true,
  payment_timing: false,
  inventory_order: false,
};

interface AppliedParameter {
  readonly snapshot: ScenarioSnapshot;
  readonly upfrontOutlayMinor: number;
  readonly assumptions: readonly ScenarioAssumption[];
}

function applyParameter(
  snapshot: ScenarioSnapshot,
  parameter: ScenarioParameter,
  index: number,
): AppliedParameter {
  switch (parameter.type) {
    case 'price_change':
      return applyToScenario(snapshot, parameter, index, (current, changeBps) => ({
        revenue: applyPriceChange(current.revenue, changeBps),
      }), PRICE_ASSUMPTION);
    case 'quantity_change': {
      const changeBps = parameterChangeBps(parameter);
      return applyToScenario(snapshot, parameter, index, (current) => {
        const scaled = applyVolumeChange(current, changeBps);
        return { revenue: scaled.revenue, cogs: scaled.cogs };
      }, VOLUME_ASSUMPTION);
    }
    case 'cost_change':
      return applyToScenario(snapshot, parameter, index, (current, changeBps) => ({
        cogs: applyCostChange(current.cogs, changeBps),
      }), COST_ASSUMPTION);
    case 'discount_change':
      return applyToScenario(snapshot, parameter, index, (current) => ({
        revenue: applyDiscountChange(current, parameter.newValue),
      }), DISCOUNT_ASSUMPTION);
    case 'expense_change':
      return applyToScenario(snapshot, parameter, index, (current) => ({
        operatingExpenses: adjustExpenses(current.operatingExpenses, parameter),
      }), EXPENSE_ASSUMPTION);
    case 'payment_timing':
      return {
        snapshot,
        upfrontOutlayMinor: 0,
        assumptions: [timingAssumption(parameter)],
      };
    case 'inventory_order':
      return {
        snapshot,
        upfrontOutlayMinor: inventoryOutlay(parameter),
        assumptions: [inventoryAssumption(parameter)],
      };
  }
}

function applyToScenario(
  snapshot: ScenarioSnapshot,
  parameter: ScenarioParameter,
  index: number,
  mutate: (
    current: ScenarioSnapshot,
    changeBps: number,
  ) => { revenue?: number; cogs?: number; operatingExpenses?: number },
  assumption: (parameter: ScenarioParameter) => ScenarioAssumption,
): AppliedParameter {
  const changeBps = parameterChangeBps(parameter);
  const patch = mutate(snapshot, changeBps);
  void index;
  return {
    snapshot: normaliseSnapshot({
      ...snapshot,
      revenue: patch.revenue ?? snapshot.revenue,
      cogs: patch.cogs ?? snapshot.cogs,
      operatingExpenses: patch.operatingExpenses ?? snapshot.operatingExpenses,
    }),
    upfrontOutlayMinor: 0,
    assumptions: [assumption(parameter)],
  };
}

/**
 * Adjusts operating expense by either a bps rate or an absolute amount.
 *
 * Both forms are supported because "cut marketing by 20%" and "cut marketing by
 * 5,000" are both questions a merchant actually asks.
 */
function adjustExpenses(current: number, parameter: ScenarioParameter): number {
  if (parameter.unit === 'amount') {
    return Math.max(0, roundHalfAwayFromZero(parameter.newValue));
  }
  return Math.max(
    0,
    roundHalfAwayFromZero(current + applyBpsToMinorUnits(current, parameterChangeBps(parameter))),
  );
}

/**
 * Outlay to fund a stock order.
 *
 * Derived from the product's cost price, which the application layer must attach
 * to the parameter's `currentValue`. Without it the engine cannot price the
 * order and the parameter is rejected instead of being priced at zero.
 */
function inventoryOutlay(parameter: ScenarioParameter): number {
  if (parameter.currentValue <= 0) return 0;
  return applyBpsToMinorUnits(parameter.currentValue, quantityToBps(parameter.newValue));
}

function quantityToBps(quantity: number): number {
  return quantity * 10_000;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Deltas between two snapshots.
 *
 * `direction` is `unavailable` when the baseline profit is zero, because there is
 * no defined growth rate from nothing. Reporting 0% there would let the AI layer
 * say "no change" about a figure that does not exist.
 */
export function compareSnapshots(
  baseline: ScenarioSnapshot,
  projected: ScenarioSnapshot,
): ScenarioComparison {
  const profitDelta = projected.netProfit - baseline.netProfit;
  const revenueDelta = projected.revenue - baseline.revenue;
  const grossProfitDelta = projected.grossProfit - baseline.grossProfit;

  if (baseline.netProfit === 0) {
    return {
      revenueDelta,
      grossProfitDelta,
      profitDelta,
      marginDeltaBps: projected.netMarginBps - baseline.netMarginBps,
      adverse: profitDelta < 0,
      direction: 'unavailable',
      summary:
        'Baseline net profit is zero, so no percentage change can be stated for this scenario.',
    };
  }

  const direction: ScenarioComparison['direction'] =
    profitDelta > 0 ? 'increase' : profitDelta < 0 ? 'decrease' : 'no_change';
  const percentageBps = roundHalfAwayFromZero((profitDelta / Math.abs(baseline.netProfit)) * 10_000);

  return {
    revenueDelta,
    grossProfitDelta,
    profitDelta,
    marginDeltaBps: projected.netMarginBps - baseline.netMarginBps,
    adverse: profitDelta < 0,
    direction,
    summary:
      `Net profit ${direction === 'increase' ? 'rises' : direction === 'decrease' ? 'falls' : 'is unchanged'} ` +
      `by ${Math.abs(profitDelta)} minor units (${percentageBps} bps) against a baseline of ` +
      `${baseline.netProfit} minor units.`,
  };
}

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

function assumptionFor(
  id: string,
  statement: string,
  limitation: string,
  material: boolean,
): ScenarioAssumption {
  return { id, statement, limitation, material };
}

const PRICE_ASSUMPTION = (parameter: ScenarioParameter): ScenarioAssumption =>
  assumptionFor(
    'price-change-constant-volume',
    `Selling prices change by ${parameterChangeBps(parameter)} bps while units sold stay at ${parameter.targetName ?? 'the baseline volume'}.`,
    'Real demand would normally respond to a price change. No elasticity data is stored, so volume is held constant and the result is an upper bound on the revenue effect.',
    true,
  );

const VOLUME_ASSUMPTION = (parameter: ScenarioParameter): ScenarioAssumption =>
  assumptionFor(
    'quantity-change-constant-unit-economics',
    `Units sold change by ${parameterChangeBps(parameter)} bps while unit price and unit cost stay unchanged.`,
    'Volume changes usually move unit cost through bulk discounts. None are modelled, so gross margin is unchanged by construction.',
    true,
  );

const COST_ASSUMPTION = (parameter: ScenarioParameter): ScenarioAssumption =>
  assumptionFor(
    'cost-change-constant-volume',
    `Cost of goods changes by ${parameterChangeBps(parameter)} bps while revenue is unchanged.`,
    'A supplier price change may be negotiable or may trigger a price adjustment. Neither is modelled.',
    true,
  );

const DISCOUNT_ASSUMPTION = (parameter: ScenarioParameter): ScenarioAssumption =>
  assumptionFor(
    'discount-change-constant-volume',
    `The discount rate moves to ${parameter.newValue} bps of gross revenue while units sold stay unchanged.`,
    'Reducing discounting normally raises volume. That effect is not modelled, so the result understates the benefit of discounting less.',
    true,
  );

const EXPENSE_ASSUMPTION = (parameter: ScenarioParameter): ScenarioAssumption =>
  assumptionFor(
    'expense-change-constant-other',
    `The ${parameter.targetName ?? 'selected'} expense becomes ${parameter.newValue}${
      parameter.unit === 'amount' ? ' minor units' : ` bps (${parameterChangeBps(parameter)} bps change)`
    }.`,
    'An expense change may affect revenue if it is a marketing or staffing expense. No such link is modelled.',
    true,
  );

const timingAssumption = (parameter: ScenarioParameter): ScenarioAssumption =>
  assumptionFor(
    'payment-timing-no-profit-effect',
    `Payment timing shifts by ${parameter.newValue} day(s).`,
    'Moving a payment changes when cash moves, not what was earned or spent. Profit and loss in this period are unchanged by design.',
    false,
  );

const inventoryAssumption = (parameter: ScenarioParameter): ScenarioAssumption =>
  assumptionFor(
    'inventory-order-cash-only',
    `Ordering ${parameter.newValue} unit(s) at a recorded cost of ${parameter.currentValue} minor units per unit.`,
    'Stock bought in this period only affects cost of goods when it is sold. No future sale is projected, so this scenario shows the cash outlay and not the margin it may eventually produce.',
    false,
  );

/** Baseline assumptions stated on every scenario regardless of parameters. */
export const BASELINE_ASSUMPTIONS: readonly ScenarioAssumption[] = [
  assumptionFor(
    'single-period-baseline',
    'The baseline is one reporting period taken from recorded transactions.',
    'A single period may be unrepresentative. Compare with a period covering a normal trading cycle.',
    true,
  ),
  assumptionFor(
    'no-cross-effects',
    'Parameters are applied independently and in the order supplied.',
    'Parameters that interact in reality (a price rise alongside a volume drop) are modelled as compounding arithmetic, not as a jointly optimised outcome.',
    true,
  ),
  assumptionFor(
    'no-execution',
    'The result is hypothetical. No price, stock, invoice or payment is changed.',
    'Nothing here has been applied to the business. Acting on it requires a separate approved action.',
    true,
  ),
];