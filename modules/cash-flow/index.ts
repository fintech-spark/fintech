// Public API of the cash-flow module.
//
// Consumers import from `@/modules/cash-flow` only. Everything below
// `domain/`, `application/` and `infrastructure/` is internal.
//
// Contract summary:
//
//   * Every value returned is a PROJECTION, never an observation. The type
//     carries `isProjection: true`, the `assumptions` it rests on, and a
//     `coverage` score describing how much of it is backed by dated records.
//   * Every line item carries `confidence` (`actual` | `expected` |
//     `projected`) and `assumptionBased`, so "observed" and "assumed" are
//     separable at the line level as well as the forecast level.
//   * Amounts are integer minor units. Currency comes from the business record.
//   * The engine in `domain/engine.ts` is pure: no clock, no I/O, no randomness.
//     Identical inputs always produce an identical projection.

export type {
  CashFlowAssumptions,
  CashFlowCategory,
  CashFlowConfidence,
  CashFlowForecast,
  CashFlowInputs,
  CashFlowItem,
  CashFlowPeriod,
  CashFlowProjection,
  CashFlowRisk,
  CashFlowSourceType,
  DatedExpenseInput,
  ForecastAssumption,
  ForecastCoverage,
  HistoricalPeriodInput,
  ObligationInput,
  OpeningBalanceSource,
  RecurringExpenseInput,
  RecurringFrequency,
  RiskSeverity,
  RiskType,
  HalfOpenPeriod,
  BucketGranularity,
} from './domain/types';

export {
  applyRunningBalances,
  buildAssumption,
  buildCashFlowPeriod,
  buildCoverage,
  buildItem,
  bucketForDate,
  calculateLowBalanceThreshold,
  calculateNetFlow,
  CASH_FLOW_CATEGORY_LABELS,
  categoryForExpense,
  collectRisks,
  CONCENTRATION_RISK_BPS,
  detectHighConcentration,
  detectLowBalance,
  detectNegativeBalance,
  detectPaymentSpike,
  MAX_RECURRING_OCCURRENCES,
  meanHistoricalInflow,
  MIN_HISTORY_PERIODS,
  nextOccurrence,
  occurrencesInHorizon,
  PAYMENT_SPIKE_MULTIPLIER,
  STRUCTURAL_GAPS,
  type CashBucket,
} from './domain/rules';

export {
  averageMonthlyOutflow,
  applyHistoricalInflows,
  createBuckets,
  distributeDatedItems,
  projectCashFlow,
  scaleMeanToBucket,
  totalForCategory,
} from './domain/engine';

export type {
  CashFlowService,
  UpcomingObligations,
} from './application/service';

export {
  DEFAULT_HORIZON_DAYS,
  MAX_HORIZON_DAYS,
  MAX_OBLIGATION_WINDOW_DAYS,
  normaliseHorizon,
  PostgresCashFlowService,
} from './application/postgres-cash-flow-service';

export {
  asRecurringFrequency,
  DEFAULT_HORIZON_DAYS as DEFAULT_HORIZON_DAYS_EXPORT,
  MAX_HISTORY_PERIODS,
  RECURRING_FREQUENCIES,
  type CashFlowForecastRow,
  type CashFlowForecastStore,
  type CashFlowRepository,
} from './infrastructure/cash-flow-repository';

export {
  MAX_OBLIGATION_ROWS,
  MAX_RECURRING_ROWS,
  PostgresCashFlowRepository,
  totalObligations,
} from './infrastructure/postgres-cash-flow-repository';

export {
  assertOwnedByTenant,
  PostgresCashFlowForecastStore,
} from './infrastructure/postgres-cash-flow-store';

export { hydrateForecast, toForecastRow } from './infrastructure/cash-flow-serialization';