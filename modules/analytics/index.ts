// Public API of the analytics module.
//
// Consumers import from `@/modules/analytics` only. Everything below
// `domain/`, `application/` and `infrastructure/` is internal: another module
// reaching into `modules/analytics/infrastructure/postgres-analytics-repository`
// would couple itself to this module's storage choice.
//
// Contract summary for the consumers of this module:
//
//   * All monetary values are `Money` in integer minor units of the business
//     currency. There are no floating-point currency figures.
//   * All periods are HALF-OPEN: `from` inclusive, `to` exclusive. `[Jan 1, Feb 1)`
//     is January. Adjacent periods therefore join without double counting.
//   * "Unknown" is never "zero". A figure that cannot be derived is reported as
//     `undefined` on `readMetric` and listed in `snapshot.unavailableMetrics`.
//   * The AI layer may describe these figures but must never recompute them.
//     Every ratio, delta and total here is already final.

export type {
  DataQuality,
  CogsRecognition,
  ExpenseCategoryTotal,
  FinancialMetric,
  FinancialSnapshot,
  LedgerCashMovement,
  MetricAvailability,
  MetricName,
  MetricUnit,
  RevenueRecognition,
  SaleTotals,
  UnavailableReason,
} from './domain/types';

export {
  CLOSED_RECEIVABLE_STATUSES,
  OPEN_PAYABLE_STATUSES,
  OPEN_RECEIVABLE_STATUSES,
  PAYMENT_TRANSACTION_TYPE,
  PURCHASE_TRANSACTION_TYPE,
  RECOGNIZED_EXPENSE_STATUSES,
  RECOGNIZED_TRANSACTION_STATUSES,
  REFUND_TRANSACTION_TYPE,
  SALE_TRANSACTION_TYPE,
  type RecognizedExpenseStatus,
  type RecognizedTransactionStatus,
} from './domain/types';

export {
  applyBpsToMinorUnits,
  assertMinorUnits,
  bpsToPercent,
  changeBps,
  clamp,
  hashString,
  isSafeInteger,
  marginBps,
  maxOf,
  mean,
  median,
  percentToBps,
  ratioBps,
  roundHalfAwayFromZero,
  stableKey,
  sumMinorUnits,
  weightedAverageMinorUnits,
  BPS_SCALE,
} from './domain/numeric';

export {
  chooseBucketGranularity,
  DEFAULT_REPORTING_TIMEZONE,
  describePeriod,
  endOfReportingDay,
  endOfReportingMonth,
  endOfReportingWeek,
  periodLengthInDays,
  previousEquivalentPeriod,
  resolveReportingTimezone,
  splitIntoBuckets,
  splitIntoReportingDays,
  splitIntoReportingMonths,
  splitIntoWeeks,
  startOfReportingDay,
  startOfReportingMonth,
  toReportingDateLabel,
  zonedWallClockToUtc,
  WEEKLY_HORIZON_MAX_DAYS,
  type BucketGranularity,
  type HalfOpenPeriod,
} from './domain/periods';

export {
  averageOrderValueMinor,
  EMPTY_SALE_TOTALS,
  expenseBreakdown,
  inventoryValueMinor,
  isRecognizedExpenseStatus,
  isRecognizedTransactionStatus,
  ledgerCashMovement,
  lineCostMinor,
  openBalanceMinor,
  recognizeCogs,
  recognizeRevenue,
  toBpsFromQuantity,
  toMoney,
  totalOperatingExpensesMinor,
  workingCapitalMinor,
} from './domain/revenue';

export {
  buildFinancialSnapshot,
  calculateCashPosition,
  calculateChangeBps,
  calculateGrossProfit,
  calculateMarginBps,
  calculateNetProfit,
  periodChangeBps,
  roundForDisplay,
  snapshotMarginBps,
} from './domain/rules';

export type { AnalyticsService, MetricDelta, PeriodComparison, ProductPerformance, RevenueShare } from './application/service';

export {
  buildDeltaValues,
  MAX_CASH_WINDOW_DAYS,
  PostgresAnalyticsService,
  readMetric,
  toHalfOpen,
  validatePeriod,
  DASHBOARD_METRICS,
} from './application/postgres-analytics-service';

export type {
  AnalyticsRepository,
  ProductPerformanceRow,
  ProductSalesRow,
  RevenueShareRow,
} from './infrastructure/analytics-repository';

export { PostgresAnalyticsRepository } from './infrastructure/postgres-analytics-repository';

export type {
  Comparison,
  GeoMetric,
  GrowthPoint,
  PulsePeriod,
  PulseRow,
  TrendPoint,
} from './domain/phonepe-pulse';

export {
  buildGrowthSeries,
  buildTransactionTrend,
  comparePeriods,
  compareValues,
  isValidPeriod,
  latestPeriod,
  periodKey,
  previousQuarter,
  rankGeographies,
  sameQuarterLastYear,
} from './domain/phonepe-pulse';

export type {
  CategoryBreakdown,
  PhonePePulseBenchmarkSummary,
  PhonePePulseRepository,
} from './infrastructure/phonepe-pulse-repository';

export { PostgresPhonePePulseRepository } from './infrastructure/phonepe-pulse-repository';