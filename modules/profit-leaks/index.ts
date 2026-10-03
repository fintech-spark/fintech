// Public API of the profit-leaks module.
//
// Consumers import from `@/modules/profit-leaks` only.
//
// Contract summary:
//
//   * A leak is a measurement. Every one carries `calculation` (rule, formula,
//     inputs, observed, baseline, deviation, periods) and `evidence` (typed source
//     references). A consumer can explain a leak without recomputing anything.
//   * A detector that stayed quiet reports why, in `suppressed`. Silence is never
//     presented as "no problem found".
//   * A detector that cannot be implemented with the current schema reports
//     itself in `detectorsUnavailable` with the data it would need.
//   * Impact and every input figure are integer minor units of the business
//     currency; ratios are basis points.
//   * Leak ids are deterministic (tenant, category, period, impact), so rerunning
//     detection over an unchanged period updates rather than duplicates.

export type {
  EvidenceType,
  LeakCalculation,
  LeakCategory,
  LeakDetectionReport,
  LeakEvidence,
  LeakSeverity,
  LeakStatus,
  ProfitLeak,
  SuppressedDetector,
  SuppressionReason,
  UnavailableDetector,
} from './domain/types';

export {
  ABNORMAL_EXPENSE_MIN_INCREASE_MINOR,
  ABNORMAL_EXPENSE_MULTIPLIER,
  DEAD_INVENTORY_DAYS,
  DEAD_INVENTORY_MIN_VALUE_MINOR,
  DISCOUNT_RATE_FLOOR_BPS,
  DISCOUNT_RATE_RISE_BPS,
  LOW_MARGIN_FLOOR_BPS,
  MARGIN_COMPRESSION_BPS,
  MAX_REPORTED_IMPACT_MINOR,
  MIN_BASELINE_SAMPLE_SIZE,
  MIN_SAMPLE_SIZE,
  PRODUCT_MIN_AGE_DAYS,
  SUPPLIER_COST_INCREASE_BPS,
  abnormalExpenseImpact,
  clampImpact,
  classifySeverity,
  deadInventoryValueMinor,
  evidence,
  excessiveDiscountImpact,
  floorMarginMinor,
  hasMinimumEvidence,
  impactPeriodLabel,
  isProductMature,
  lowMarginImpact,
  marginCompressionImpact,
  meetsThreshold,
  overdueReceivablesImpact,
  quantityToBps,
  referencedRecordIds,
  supplierCostIncreaseImpact,
  suppressionReason,
  totalImpactMinor,
  type SuppressionInput,
  type ThresholdKind,
} from './domain/rules';

export {
  abnormalExpensesDetector,
  deadInventoryDetector,
  DETECTORS,
  excessiveDiscountingDetector,
  highPaymentFeesDetector,
  highPaymentFeesUnavailable,
  lowMarginProductsDetector,
  marginCompressionDetector,
  overdueReceivablesDetector,
  supplierCostIncreaseDetector,
  UNAVAILABLE_DETECTORS,
  type Detector,
  type DetectorContext,
  type DetectorResult,
  type OverdueReceivable,
  type ProductAggregate,
  type ProductSaleAggregate,
  type PurchasePriceAggregate,
} from './domain/detectors';

export {
  FORMULAS,
  leakId,
  notFired,
  sumInputs,
  sumOf,
  suppress,
  toResult,
  type LeakDraft,
} from './domain/assembly';

export type { LeakFilters, ProfitLeakService } from './application/service';

export { PostgresProfitLeakService } from './application/postgres-profit-leak-service';

export type { LeakFilterInput, ProfitLeakRepository } from './infrastructure/repository';

export {
  assertLeakStatus,
  leakDedupeKey,
  PostgresProfitLeakRepository,
  totalImpact,
} from './infrastructure/postgres-profit-leak-repository';