// Assembly of a detected leak from a detector's draft, plus the shared helpers
// every detector uses to report why it stayed quiet.
//
// Split out of `detectors.ts` to keep both files inside the repository's 800-line
// ceiling. Nothing here makes a decision: it turns a draft plus evidence into a
// `ProfitLeak`, or a suppression reason into a `SuppressedDetector`.

import type {
  LeakCalculation,
  LeakCategory,
  LeakEvidence,
  ProfitLeak,
  SuppressionReason,
} from './types';
import {
  MIN_SAMPLE_SIZE,
  classifySeverity,
  hasMinimumEvidence,
  impactPeriodLabel,
  referencedRecordIds,
} from './rules';
import type { Detector, DetectorContext, DetectorResult } from './detectors';

// ---------------------------------------------------------------------------
// Shared assembly
// ---------------------------------------------------------------------------

export interface LeakDraft {
  readonly rule: LeakCategory;
  readonly inputs: Readonly<Record<string, number>>;
  readonly observedValue: number;
  readonly baselineValue: number;
  readonly deviation: number;
  readonly deviationUnit: 'minor_units' | 'ratio_bps' | 'quantity';
  readonly impactMinor: number;
  readonly title: string;
  readonly description: string;
  readonly suggestedInvestigation: string;
}

/**
 * Deterministic id for a leak.
 *
 * Derived from tenant, category, period and impact, so re-running detection over
 * the same period produces the same id and persisted leaks stay de-duplicable
 * instead of accumulating a row per run.
 */
export function leakId(
  context: DetectorContext,
  category: LeakCategory,
  impactMinor: number,
): string {
  return [
    context.businessId,
    category,
    context.period.from.toISOString(),
    context.period.to.toISOString(),
    String(impactMinor),
  ].join(':');
}

export function toResult(
  detector: Detector,
  context: DetectorContext,
  entries: readonly LeakEvidence[],
  draft: LeakDraft,
): DetectorResult {
  if (!hasMinimumEvidence(entries.length, detector.category)) {
    return suppress(
      detector.category,
      {
        reason: 'insufficient_sample_size',
        explanation: `Only ${entries.length} evidence item(s) are available; this rule needs more.`,
      },
      context,
    );
  }

  const calculation: LeakCalculation = {
    rule: draft.rule,
    ruleDescription: detector.rule,
    formula: FORMULAS[draft.rule],
    inputs: draft.inputs,
    observedValue: draft.observedValue,
    baselineValue: draft.baselineValue,
    deviation: draft.deviation,
    deviationUnit: draft.deviationUnit,
    periodStart: context.period.from,
    periodEnd: context.period.to,
    comparisonPeriodStart: context.previousPeriod.from,
    comparisonPeriodEnd: context.previousPeriod.to,
    currency: context.currency,
  };

  const leak: ProfitLeak = {
    id: leakId(context, detector.category, draft.impactMinor),
    businessId: context.businessId,
    category: detector.category,
    severity: classifySeverity(draft.impactMinor),
    title: draft.title,
    description: draft.description,
    impact: { amount: draft.impactMinor, currency: context.currency as ProfitLeak['impact']['currency'] },
    impactPeriod: impactPeriodLabel(context.period.from, context.period.to),
    evidence: entries,
    status: 'active',
    detectedAt: context.detectedAt,
    currency: context.currency,
    calculation,
    suggestedInvestigation: draft.suggestedInvestigation,
    relatedRecordIds: referencedRecordIds(entries),
  };

  return { fired: true, leak };
}

/**
 * Human-readable formula per rule, surfaced in the "why am I seeing this?" panel
 * so the arithmetic is inspectable without reading the code.
 */
/**
 * The arithmetic behind each rule, keyed by the rule's stable category id.
 *
 * Keyed by category rather than by prose so a reworded rule string cannot silently
 * orphan its formula; `tests/intelligence/profit-leaks.test.ts` asserts every
 * detector has an entry here.
 */
export const FORMULAS: Readonly<Record<LeakCategory, string>> = {
  margin_compression:
    'impact = round(currentRevenue * baselineGrossMarginBps / 10000) - currentGrossProfit',
  supplier_cost_increase:
    'impact = sum over affected products of round((currentWeightedUnitPrice - baselineWeightedUnitPrice) * quantitySold)',
  excessive_discounting:
    'impact = currentDiscount - round(currentGrossRevenue * baselineDiscountRateBps / 10000)',
  abnormal_expenses:
    'impact = sum over affected categories of max(0, currentCategoryTotal - baselineCategoryTotal)',
  low_margin_products:
    'impact = sum over products of round((floorMarginPerUnit - unitMargin) * quantitySold)',
  dead_inventory: 'impact = sum over idle products of round(costPrice * currentStock)',
  overdue_receivables:
    'impact = sum of open balances (amount - paid) for receivables past the business overdue threshold',
  high_payment_fees: 'not computable with the current schema',
};

export function suppress(
  category: LeakCategory,
  gate: { reason: SuppressionReason; explanation: string },
  context: DetectorContext,
): DetectorResult {
  return {
    fired: false,
    suppressed: {
      category,
      reason: gate.reason,
      explanation: gate.explanation,
      observed: context.current.revenue.amount,
      baseline: context.previous.revenue.amount,
      threshold: MIN_SAMPLE_SIZE,
      sampleSize: context.current.revenueRecognition.saleCount,
    },
  };
}

export function notFired(
  category: LeakCategory,
  reason: SuppressionReason,
  explanation: string,
  numbers?: { observed?: number; baseline?: number; threshold?: number },
): DetectorResult {
  return {
    fired: false,
    suppressed: {
      category,
      reason,
      explanation,
      ...(numbers?.observed === undefined ? {} : { observed: numbers.observed }),
      ...(numbers?.baseline === undefined ? {} : { baseline: numbers.baseline }),
      ...(numbers?.threshold === undefined ? {} : { threshold: numbers.threshold }),
    },
  };
}

/** Sum of minor-unit amounts. Integer-only, so a total never drifts. */
export function sumOf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

/** Merges per-detector input maps into one flat set of calculation inputs. */
export function sumInputs(
  entries: readonly Readonly<Record<string, number>>[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}
