import { applyBpsToMinorUnits, roundHalfAwayFromZero, sumMinorUnits } from '@/modules/analytics';
import type { LeakEvidence, LeakSeverity } from './types';

// ---------------------------------------------------------------------------
// Existing published thresholds — preserved exactly
// ---------------------------------------------------------------------------

/**
 * Severity band by monthly impact, in minor units.
 *   critical  >= 5,000,000  (INR 50,000)
 *   high      >= 1,000,000  (INR 10,000)
 *   medium    >=   200,000  (INR  2,000)
 *   low       <    200,000
 *
 * These bands predate this implementation and are part of the module's published
 * contract; they are deliberately not re-tuned here.
 */
export function classifySeverity(monthlyImpactMinorUnits: number): LeakSeverity {
  if (monthlyImpactMinorUnits >= 50_000_00) return 'critical';
  if (monthlyImpactMinorUnits >= 10_000_00) return 'high';
  if (monthlyImpactMinorUnits >= 2_000_00) return 'medium';
  return 'low';
}

/**
 * Minimum supporting evidence per category.
 *
 * `margin_compression` and `abnormal_expenses` are aggregate claims about a whole
 * period, so a single record cannot support them; everything else is anchored to
 * one record and needs only one.
 */
export function hasMinimumEvidence(evidenceCount: number, category: string): boolean {
  const highEvidenceCategories = ['margin_compression', 'abnormal_expenses'];
  const minRequired = highEvidenceCategories.includes(category) ? 3 : 1;
  return evidenceCount >= minRequired;
}

// ---------------------------------------------------------------------------
// False-positive control — thresholds defined by this implementation
//
// Every constant below is a deliberate product decision, documented here and in
// `docs/intelligence/PROFIT_LEAK_RULES.md`. Each one exists to stop a detector
// firing on ordinary week-to-week variance rather than to find more leaks.
// ---------------------------------------------------------------------------

/** Minimum recognised transactions in a period before rate-based detectors run. */
export const MIN_SAMPLE_SIZE = 5;

/** Alias kept for callers that reason about the current period explicitly. */
export const MAX_SAMPLE_SIZE = MIN_SAMPLE_SIZE;

/** Minimum recognised transactions in the baseline before comparing against it. */
export const MIN_BASELINE_SAMPLE_SIZE = 5;

/** Gross margin drop, in bps, that constitutes compression. */
export const MARGIN_COMPRESSION_BPS = 200;

/** Supplier purchase price rise, in bps, that constitutes a cost increase. */
export const SUPPLIER_COST_INCREASE_BPS = 500;

/** Discount share of gross revenue that constitutes excessive discounting. */
export const DISCOUNT_RATE_FLOOR_BPS = 1_000;

/** Rise in discount rate, in bps, on top of the floor, that constitutes a leak. */
export const DISCOUNT_RATE_RISE_BPS = 500;

/** Days without a sale before stocked inventory is considered dead. */
export const DEAD_INVENTORY_DAYS = 90;

/** Minimum at-cost value of dead stock before it is worth reporting, in minor units. */
export const DEAD_INVENTORY_MIN_VALUE_MINOR = 200_000;

/** Unit margin floor, in bps, below which a sold product is a low-margin leak. */
export const LOW_MARGIN_FLOOR_BPS = 500;

/** Category expense multiple over baseline that constitutes an anomaly. */
export const ABNORMAL_EXPENSE_MULTIPLIER = 1.5;

/** Minimum absolute category-expense increase, in minor units, for an anomaly. */
export const ABNORMAL_EXPENSE_MIN_INCREASE_MINOR = 200_000;

/** Days a product must have existed before dead-stock and margin rules apply. */
export const PRODUCT_MIN_AGE_DAYS = 30;

/** Highest single-leak impact the detector set will report, in minor units. */
export const MAX_REPORTED_IMPACT_MINOR = 100_000_000;

/**
 * Gate for every detector.
 *
 * Returns `null` when the detector may proceed, or a human-readable reason when
 * it must not. Centralising this is what keeps "insufficient evidence" a
 * consistent, reportable state rather than eight different ad-hoc checks.
 */
/**
 * How a detector's threshold must be compared.
 *
 * `multiple`        - observed must reach `threshold` TIMES the baseline (e.g. 1.5x)
 * `at_least`        - observed must reach an absolute value (e.g. a 1000 bps rate floor)
 * `at_most`         - observed must stay at or below an absolute value
 * `fall_by_at_least`- baseline minus observed must be at least `threshold`, i.e. the
 *                      figure must have deteriorated by that much relative to the
 *                      baseline (e.g. a margin that fell at least 200 bps)
 *
 * Declaring the kind explicitly matters: inferring it from the threshold's
 * numeric value silently mis-compares. A multiplier of 1.5 and an absolute floor
 * of 1.5 are both plausible inputs, and a detector that guesses wrong fires on
 * every record instead of none.
 */
export type ThresholdKind = 'multiple' | 'at_least' | 'at_most' | 'fall_by_at_least';

export interface SuppressionInput {
  readonly currentSampleSize: number;
  readonly baselineSampleSize: number | undefined;
  readonly observed: number;
  readonly baseline: number | undefined;
  readonly threshold: number;
  readonly thresholdKind: ThresholdKind;
  /** Skips the baseline sample-size gate for detectors that do not compare periods. */
  readonly baselineOptional?: boolean;
}

/**
 * Gate for every detector.
 *
 * Returns `null` when the detector may proceed, or a human-readable reason when
 * it must not. Centralising this is what keeps "insufficient evidence" a
 * consistent, reportable state rather than eight different ad-hoc checks.
 */
export function suppressionReason(
  input: SuppressionInput,
): { readonly reason: import('./types').SuppressionReason; readonly explanation: string } | null {
  if (input.baselineSampleSize === 0) {
    return {
      reason: 'insufficient_sample_size',
      explanation:
        'The compared period has no recognised transactions, so there is nothing to compare against.',
    };
  }
  if (input.baselineOptional !== true && input.baselineSampleSize !== undefined) {
    if (input.baselineSampleSize < MIN_BASELINE_SAMPLE_SIZE) {
      return {
        reason: 'insufficient_sample_size',
        explanation:
          `The baseline period has ${input.baselineSampleSize} recognised transaction(s); ` +
          `at least ${MIN_BASELINE_SAMPLE_SIZE} are required for a period-over-period comparison.`,
      };
    }
  }
  if (input.currentSampleSize < MIN_SAMPLE_SIZE) {
    return {
      reason: 'insufficient_sample_size',
      explanation:
        `The period has ${input.currentSampleSize} recognised transaction(s); ` +
        `at least ${MIN_SAMPLE_SIZE} are required before rate-based conclusions are drawn.`,
    };
  }
  if (input.baseline === undefined) {
    return {
      reason: 'no_baseline_period',
      explanation: 'There is no preceding equivalent period to compare against.',
    };
  }
  if (input.baseline === 0 && input.thresholdKind !== 'at_most' && input.thresholdKind !== 'fall_by_at_least') {
    return {
      reason: 'zero_baseline',
      explanation:
        'The baseline figure is zero, so a percentage or absolute deviation against it is undefined.',
    };
  }
  if (!meetsThreshold(input.observed, input.baseline, input.threshold, input.thresholdKind)) {
    return {
      reason: 'threshold_not_met',
      explanation:
        `Observed ${input.observed} against baseline ${input.baseline} does not reach the ` +
        `threshold of ${input.threshold} (${input.thresholdKind}).`,
    };
  }
  return null;
}

/**
 * Threshold comparison against an explicitly declared kind.
 *
 * `multiple` is evaluated against the baseline; `at_least` and `at_most` are
 * absolute, which is what lets a detector state a rule like "margin fell by at
 * least 200 bps" without that 200 being mistaken for a multiplier.
 */
export function meetsThreshold(
  observed: number,
  baseline: number,
  threshold: number,
  kind: ThresholdKind,
): boolean {
  switch (kind) {
    case 'multiple':
      return baseline === 0 ? observed > 0 : observed >= baseline * threshold;
    case 'at_least':
      return observed >= threshold;
    case 'at_most':
      return observed <= threshold;
    case 'fall_by_at_least':
      return baseline - observed >= threshold;
  }
}

/** Clamps a computed impact into the reportable range. */
export function clampImpact(impactMinor: number): number {
  if (!Number.isFinite(impactMinor)) return 0;
  if (impactMinor <= 0) return 0;
  return Math.min(roundHalfAwayFromZero(impactMinor), MAX_REPORTED_IMPACT_MINOR);
}

// ---------------------------------------------------------------------------
// Detection maths — pure, individually testable
// ---------------------------------------------------------------------------

/**
 * Gross profit lost to margin compression.
 *
 * `baselineMarginBps` is the margin the merchant earned in the comparison period.
 * Applied to this period's revenue it gives the gross profit they would have had
 * at the old margin; the shortfall is the impact.
 */
export function marginCompressionImpact(input: {
  readonly currentRevenueMinor: number;
  readonly currentGrossProfitMinor: number;
  readonly baselineMarginBps: number;
}): number {
  const expectedGrossProfit = applyBpsToMinorUnits(
    input.currentRevenueMinor,
    input.baselineMarginBps,
  );
  return Math.max(0, expectedGrossProfit - input.currentGrossProfitMinor);
}

/**
 * Extra discount given away beyond the baseline discount rate.
 *
 * `baselineDiscountRateBps` is applied to this period's gross revenue; anything
 * discounted above that rate is the leak.
 */
export function excessiveDiscountImpact(input: {
  readonly currentGrossRevenueMinor: number;
  readonly currentDiscountMinor: number;
  readonly baselineDiscountRateBps: number;
}): number {
  const baselineDiscount = applyBpsToMinorUnits(
    input.currentGrossRevenueMinor,
    input.baselineDiscountRateBps,
  );
  return Math.max(0, input.currentDiscountMinor - baselineDiscount);
}

/**
 * Cost increase on units the merchant actually sold.
 *
 * The weighted average purchase price is compared between periods, so the impact
 * is the per-unit increase multiplied by the quantity sold this period. Using
 * quantity actually sold keeps the figure tied to realised loss rather than
 * hypothetical stock.
 */
export function supplierCostIncreaseImpact(input: {
  readonly currentWeightedUnitPriceMinor: number;
  readonly baselineWeightedUnitPriceMinor: number;
  readonly quantitySold: number;
}): number {
  const increasePerUnit = input.currentWeightedUnitPriceMinor - input.baselineWeightedUnitPriceMinor;
  if (increasePerUnit <= 0 || input.quantitySold <= 0) return 0;
  return applyBpsToMinorUnits(increasePerUnit, quantityToBps(input.quantitySold));
}

/**
 * Profit shortfall against the low-margin floor.
 *
 * For each product sold below the margin floor, the impact is the per-unit
 * shortfall multiplied by units sold. Summing per product keeps products with
 * large volumes and thin margins fully represented.
 */
export function lowMarginImpact(input: {
  readonly unitMarginMinor: number;
  readonly floorMarginMinor: number;
  readonly quantitySold: number;
}): number {
  const shortfall = input.floorMarginMinor - input.unitMarginMinor;
  if (shortfall <= 0 || input.quantitySold <= 0) return 0;
  return applyBpsToMinorUnits(shortfall, quantityToBps(input.quantitySold));
}

/** Margin floor expressed in minor units for one unit. */
export function floorMarginMinor(
  sellingPriceMinor: number,
  floorBps: number = LOW_MARGIN_FLOOR_BPS,
): number {
  return applyBpsToMinorUnits(sellingPriceMinor, floorBps);
}

/** Value of unsold stock at cost, in minor units. */
export function deadInventoryValueMinor(input: {
  readonly currentStock: number;
  readonly costPriceMinor: number;
}): number {
  if (input.currentStock <= 0) return 0;
  return applyBpsToMinorUnits(input.costPriceMinor, quantityToBps(input.currentStock));
}

/** Converts a fractional quantity into the bps multiplier used for minor-unit scaling. */
export function quantityToBps(quantity: number): number {
  if (!Number.isFinite(quantity)) {
    throw new RangeError(`Quantity must be finite, got ${quantity}.`);
  }
  return quantity * 10_000;
}

/** Excess spend on an expense category over its baseline. */
export function abnormalExpenseImpact(input: {
  readonly currentMinor: number;
  readonly baselineMinor: number;
}): number {
  return Math.max(0, input.currentMinor - input.baselineMinor);
}

/** Open balance of overdue receivables, in minor units. */
export function overdueReceivablesImpact(openMinor: number): number {
  return Math.max(0, roundHalfAwayFromZero(openMinor));
}

/**
 * Gates a product-level detector on product age.
 *
 * A SKU created last week cannot have a meaningful trend, and reporting a leak on
 * it would be an artefact of onboarding rather than a business problem.
 */
export function isProductMature(input: {
  readonly createdAt: Date;
  readonly asOf: Date;
}): boolean {
  const ageDays = (input.asOf.getTime() - input.createdAt.getTime()) / 86_400_000;
  return ageDays >= PRODUCT_MIN_AGE_DAYS;
}

// ---------------------------------------------------------------------------
// Evidence construction
// ---------------------------------------------------------------------------

/**
 * Builds one evidence entry.
 *
 * `resourceId` is required even for a calculation, and is the stable key of the
 * rule or product that produced it, so every leak has at least one addressable
 * source reference as the evidence rules require.
 */
export function evidence(input: {
  readonly type: LeakEvidence['type'];
  readonly resourceId: string;
  readonly description: string;
  readonly value?: number;
}): LeakEvidence {
  return {
    type: input.type,
    resourceId: input.resourceId,
    description: input.description,
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}

/** Distinct record ids cited by a set of evidence entries. */
export function referencedRecordIds(evidence: readonly LeakEvidence[]): string[] {
  return [...new Set(evidence.map((entry) => entry.resourceId).filter((id) => id.length > 0))];
}

/** Total impact of a set of leaks, in minor units. */
export function totalImpactMinor(leaks: readonly { impact: { amount: number } }[]): number {
  return sumMinorUnits(leaks.map((leak) => leak.impact.amount));
}

/** Impact period label such as `2026-01-01 -> 2026-01-31`. */
export function impactPeriodLabel(start: Date, endExclusive: Date): string {
  const inclusiveEnd = new Date(endExclusive.getTime() - 1);
  return `${start.toISOString().slice(0, 10)} -> ${inclusiveEnd.toISOString().slice(0, 10)}`;
}