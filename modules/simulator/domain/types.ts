import type { BusinessId } from '@/lib/types';
import type { DataQuality } from '@/modules/analytics';

/**
 * What-if simulator types.
 *
 * The simulator answers "what would happen if I changed X?" It performs the
 * arithmetic; the model may only narrate the result. Three properties are
 * structural rather than conventional:
 *
 *  1. A scenario is an immutable, isolated value object. It shares no reference
 *     with any production entity and contains no repository handle, so it cannot
 *     be used to reach a write path.
 *  2. The engine is a pure function. Same baseline plus same parameters always
 *     yields the same result, which is what makes a simulation auditable.
 *  3. Every result states its assumptions and what it cannot tell you. A
 *     simulation that hides its assumptions is a forecast presented as a fact.
 */

export type ScenarioStatus = 'draft' | 'calculated' | 'expired';

export type ParameterType =
  | 'price_change'
  | 'quantity_change'
  | 'discount_change'
  | 'cost_change'
  | 'expense_change'
  | 'payment_timing'
  | 'inventory_order';

export type ParameterUnit = 'amount' | 'percentage' | 'quantity' | 'days';

/**
 * One changed input.
 *
 * `currentValue` and `newValue` are in the unit named by `unit`. For a
 * `percentage` unit both are basis points, so `currentValue: 0, newValue: 500`
 * means "from 0% to 5%".
 */
export interface ScenarioParameter {
  readonly type: ParameterType;
  readonly targetId?: string;
  readonly targetName?: string;
  readonly currentValue: number;
  readonly newValue: number;
  readonly unit: ParameterUnit;
}

/**
 * A period's financial position, in integer minor units.
 *
 * `grossRevenue` and `discounts` are carried alongside `revenue` because a
 * discount scenario needs the pre-discount figure to compute a discount rate.
 */
export interface ScenarioSnapshot {
  readonly revenue: number;
  readonly cogs: number;
  readonly grossProfit: number;
  readonly grossMarginBps: number;
  readonly operatingExpenses: number;
  readonly netProfit: number;
  readonly netMarginBps: number;
  readonly grossRevenue: number;
  readonly discounts: number;
  readonly quantitySold: number;
  readonly saleCount: number;
}

/** Difference between baseline and projected, with the direction made explicit. */
export interface ScenarioComparison {
  readonly revenueDelta: number;
  readonly grossProfitDelta: number;
  readonly profitDelta: number;
  readonly marginDeltaBps: number;
  /** True when the change moves profit against the merchant. */
  readonly adverse: boolean;
  readonly direction: 'increase' | 'decrease' | 'no_change' | 'unavailable';
  readonly summary: string;
}

/** An explicit statement of what the simulation holds constant or ignores. */
export interface ScenarioAssumption {
  readonly id: string;
  readonly statement: string;
  readonly limitation: string;
  /** True when the assumption materially affects the result. */
  readonly material: boolean;
}

/** Why a scenario is unavailable rather than calculated. */
export type ScenarioInvalidReason =
  | 'insufficient_baseline'
  | 'missing_cost_data'
  | 'no_sales_in_period'
  | 'parameter_out_of_bounds'
  | 'target_not_found'
  | 'currency_mismatch';

export interface ScenarioRejection {
  readonly parameterIndex: number;
  readonly parameterType: ParameterType;
  readonly reason: ScenarioInvalidReason;
  readonly explanation: string;
}

export interface Scenario {
  readonly id: string;
  readonly businessId: BusinessId;
  readonly name: string;
  readonly description?: string;
  readonly parameters: readonly ScenarioParameter[];
  readonly baseline: ScenarioSnapshot;
  readonly projected: ScenarioSnapshot;
  readonly comparison: ScenarioComparison;
  readonly status: ScenarioStatus;
  readonly createdAt: Date;
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly assumptions: readonly ScenarioAssumption[];
  readonly rejections: readonly ScenarioRejection[];
  readonly quality: DataQuality;
  /**
   * Always true. Present so a consumer can assert the hypothetical nature
   * programmatically instead of inferring it from context.
   */
  readonly isProjection: true;
  /** Cash effect that does not affect profit and loss. */
  readonly cashTiming: ScenarioCashTiming;
}

/**
 * Cash-only effects.
 *
 * A payment-timing change moves money between periods without changing what was
 * earned. Keeping it in its own field stops a timing shift being reported as a
 * profit improvement.
 */
export interface ScenarioCashTiming {
  /** Outlay needed to fund the scenario in the simulated period. */
  readonly upfrontOutlayMinor: number;
  /** Net effect on cash inside the simulated period. */
  readonly netCashDeltaMinor: number;
  readonly affectsProfitAndLoss: boolean;
}

/** Input for one simulation run. */
export interface RunScenarioInput {
  readonly name: string;
  readonly description?: string;
  readonly parameters: readonly ScenarioParameter[];
}

/** Filters accepted by the scenario list endpoint. */
export interface ScenarioFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly status?: ScenarioStatus;
}