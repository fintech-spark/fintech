import type { BusinessId, Money } from '@/lib/types';
import type { DataQuality } from '@/modules/analytics';

/**
 * Profit-leak types.
 *
 * A leak is a *measurement*, not a feeling. Every leak must carry enough
 * structured evidence for a merchant (and the Business Brain) to reconstruct
 * exactly why it fired: what was observed, what the baseline was, what the
 * difference is, over which periods, from which records. "Sales look bad" is not
 * an acceptable leak.
 */

export type LeakCategory =
  | 'supplier_cost_increase'
  | 'margin_compression'
  | 'excessive_discounting'
  | 'dead_inventory'
  | 'high_payment_fees'
  | 'abnormal_expenses'
  | 'overdue_receivables'
  | 'low_margin_products';

export type LeakSeverity = 'critical' | 'high' | 'medium' | 'low';

export type LeakStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';

export type EvidenceType =
  | 'transaction'
  | 'expense'
  | 'product'
  | 'supplier'
  | 'customer'
  | 'invoice'
  | 'calculation';

export type LeakEvidence = {
  readonly type: EvidenceType;
  readonly resourceId: string;
  readonly description: string;
  readonly value?: number;
};

/**
 * Why a detector did not fire.
 *
 * A suppressed detector is a first-class outcome. Reporting "insufficient
 * history" instead of silence is what stops a merchant concluding that no leak
 * exists when in fact the engine could not look.
 */
export type SuppressionReason =
  | 'no_baseline_period'
  | 'insufficient_sample_size'
  | 'zero_baseline'
  | 'insufficient_history'
  | 'missing_cost_data'
  | 'below_minimum_impact'
  | 'no_source_data'
  | 'recently_created'
  | 'threshold_not_met'
  | 'unavailable_metric';

export interface SuppressedDetector {
  readonly category: LeakCategory;
  readonly reason: SuppressionReason;
  readonly explanation: string;
  /** Numbers the detector did have, so the reason is inspectable. */
  readonly observed?: number;
  readonly baseline?: number;
  readonly threshold?: number;
  readonly sampleSize?: number;
}

export interface ProfitLeak {
  readonly id: string;
  readonly businessId: BusinessId;
  readonly category: LeakCategory;
  readonly severity: LeakSeverity;
  readonly title: string;
  readonly description: string;
  readonly impact: Money;
  readonly impactPeriod: string;
  readonly evidence: readonly LeakEvidence[];
  readonly status: LeakStatus;
  readonly detectedAt: Date;
  readonly resolvedAt?: Date;
  readonly currency: string;
  /** Explicit arithmetic behind the impact figure, for display and for review. */
  readonly calculation: LeakCalculation;
  /** What a merchant should investigate next. A pointer, never an instruction to act. */
  readonly suggestedInvestigation: string;
  /** Source-record ids the evidence cites, for deep links and audit. */
  readonly relatedRecordIds: readonly string[];
}

/**
 * The full arithmetic of a detection.
 *
 * `formula` names the rule; `inputs` are the figures it was applied to. Together
 * they let the UI render a "why am I seeing this?" panel without re-deriving
 * anything, and let a reviewer audit the rule without reading code.
 */
export interface LeakCalculation {
  /** Stable machine id of the rule that fired; matches `LeakCategory`. */
  readonly rule: LeakCategory;
  /** Human-readable statement of the rule, including its threshold. */
  readonly ruleDescription: string;
  readonly formula: string;
  readonly inputs: Readonly<Record<string, number>>;
  readonly observedValue: number;
  readonly baselineValue: number;
  readonly deviation: number;
  readonly deviationUnit: 'minor_units' | 'ratio_bps' | 'quantity';
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly comparisonPeriodStart: Date;
  readonly comparisonPeriodEnd: Date;
  readonly currency: string;
}

/** Outcome of one detection run. */
export interface LeakDetectionReport {
  readonly businessId: BusinessId;
  readonly detected: readonly ProfitLeak[];
  readonly suppressed: readonly SuppressedDetector[];
  readonly detectorsRun: readonly LeakCategory[];
  readonly detectorsUnavailable: readonly UnavailableDetector[];
  readonly quality: DataQuality;
  readonly calculatedAt: Date;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly currency: string;
  /** Aggregate impact of every detected leak in the period, in minor units. */
  readonly totalImpactMinor: number;
}

/**
 * A detector that cannot be implemented with the current data model.
 *
 * Reported instead of silently skipped, so an unavailable check is visible to
 * the product rather than looking like a clean result.
 */
export interface UnavailableDetector {
  readonly category: LeakCategory;
  readonly reason: string;
  readonly requiredData: readonly string[];
}