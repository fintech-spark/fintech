import {
  clamp,
  maxOf,
  median,
  ratioBps,
  roundHalfAwayFromZero,
  sumMinorUnits,
} from '@/modules/analytics';
import type { HalfOpenPeriod } from '@/modules/analytics';
import type {
  CashFlowCategory,
  CashFlowInputs,
  CashFlowItem,
  CashFlowPeriod,
  CashFlowRisk,
  CashFlowSourceType,
  ForecastAssumption,
  ForecastCoverage,
  OpeningBalanceSource,
  ObligationInput,
  RecurringExpenseInput,
  RecurringFrequency,
} from './types';

/**
 * The cash-flow projection engine.
 *
 * Everything in this file is a pure function of its inputs. No clock, no random
 * source, no database, no I/O. That is what makes a projection reproducible and
 * testable: the same facts always yield the same numbers, so a merchant can be
 * shown the same forecast twice.
 *
 * ---------------------------------------------------------------------------
 * Methodology
 * ---------------------------------------------------------------------------
 *
 * opening balance
 *   The ledger has no bank or cash-account table, so opening cash is derived by
 *   the analytics layer from the sum of every recognised cash-bearing
 *   transaction up to the horizon start. It is a ledger proxy and is labelled as
 *   such (`openingBalanceSource: 'ledger_derived'`). There is no bank
 *   reconciliation and no projection can claim otherwise.
 *
 * inflows
 *   `collections`  — every open receivable placed in the bucket containing its
 *                   due date. Confidence `expected`: the amount and the date are
 *                   both known, but collection is not.
 *   `sales_revenue`— only when the merchant has at least
 *                   `MIN_HISTORY_PERIODS` prior complete periods of sales.
 *                   Value is the mean of those periods, scaled to the bucket
 *                   length. Confidence `projected`, and always accompanied by an
 *                   explicit assumption entry.
 *
 * outflows
 *   `supplier_payments` — open payables by due date. Confidence `expected`.
 *   `operating_expenses` — non-recurring recognised expenses already dated in
 *                   the horizon, plus every occurrence of a recurring expense
 *                   whose next due date falls in the horizon. Confidence
 *                   `expected`. Occurrences after the first are derived from the
 *                   stored frequency, which is recorded as an assumption.
 *
 * What is deliberately NOT projected
 *   Loan repayments, tax payments and discretionary stock purchases have no
 *   representation in the schema. They are absent rather than guessed, and
 *   `knownGaps` names them so the projection cannot be read as complete.
 *
 * Coverage
 *   `coverageBps` is the share of the horizon's total projected magnitude that is
 *   backed by a dated obligation. Extrapolated inflow dilutes it. A forecast
 *   with zero coverage is reported as `insufficient_data`.
 */

const DAY_MS = 86_400_000;

/** Minimum prior periods required before any historical extrapolation happens. */
export const MIN_HISTORY_PERIODS = 3;

/** Maximum projected occurrences generated for one recurring expense. */
export const MAX_RECURRING_OCCURRENCES = 60;

/**
 * Ratio of a single bucket's outflows to the median bucket outflow that triggers
 * a `payment_spike` risk. Two times the typical bucket is a spike; anything less
 * is ordinary lumpiness and must not raise an alarm.
 */
export const PAYMENT_SPIKE_MULTIPLIER = 2;

/** Share of total receivables or payables held by one counterparty that is a risk. */
export const CONCENTRATION_RISK_BPS = 5_000;

// ---------------------------------------------------------------------------
// Period arithmetic
// ---------------------------------------------------------------------------

export function calculateNetFlow(
  inflows: readonly { amount: number }[],
  outflows: readonly { amount: number }[],
): number {
  return (
    sumMinorUnits(inflows.map((item) => item.amount)) -
    sumMinorUnits(outflows.map((item) => item.amount))
  );
}

/**
 * Low-balance threshold: ten percent of the average monthly outflow, a one-week
 * buffer. Falls back to zero when there is no outflow history, which makes the
 * rule inert rather than alarming for a merchant with no spending records.
 */
export function calculateLowBalanceThreshold(averageMonthlyOutflow: number): number {
  if (!Number.isFinite(averageMonthlyOutflow) || averageMonthlyOutflow <= 0) return 0;
  return roundHalfAwayFromZero(averageMonthlyOutflow * 0.1);
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

export interface CashBucket {
  readonly period: HalfOpenPeriod;
  readonly inflows: CashFlowItem[];
  readonly outflows: CashFlowItem[];
}

/**
 * Places an instant in the bucket that contains it.
 *
 * An obligation dated before the horizon is placed in the first bucket rather
 * than dropped: money already overdue still leaves the account, and hiding it
 * would understate the merchant's risk. Each item records the original due date
 * so the UI can show how late it is.
 */
export function bucketForDate(
  buckets: readonly { period: HalfOpenPeriod }[],
  instant: Date,
): { period: HalfOpenPeriod } | undefined {
  if (buckets.length === 0) return undefined;
  for (const bucket of buckets) {
    if (instant.getTime() < bucket.period.to.getTime()) return bucket;
  }
  return undefined;
}

/** Human label for a cash-flow category, safe to show a merchant. */
export const CASH_FLOW_CATEGORY_LABELS: Readonly<Record<CashFlowCategory, string>> = {
  sales_revenue: 'Sales revenue',
  collections: 'Customer collections',
  other_income: 'Other income',
  supplier_payments: 'Supplier payments',
  operating_expenses: 'Operating expenses',
  salaries: 'Salaries',
  rent: 'Rent',
  taxes: 'Taxes',
  loan_payments: 'Loan repayments',
  planned_purchases: 'Planned purchases',
  other_expenses: 'Other expenses',
};

/** Recurring expense categories are mapped onto cash-flow categories, not copied. */
export function categoryForExpense(expenseCategory: string): CashFlowCategory {
  switch (expenseCategory) {
    case 'salaries':
      return 'salaries';
    case 'rent':
      return 'rent';
    case 'taxes':
      return 'taxes';
    default:
      return 'operating_expenses';
  }
}

// ---------------------------------------------------------------------------
// Recurrence expansion
// ---------------------------------------------------------------------------

/** Next occurrence of a recurring expense, or `null` when the series has ended. */
export function nextOccurrence(
  current: Date,
  frequency: RecurringFrequency,
): Date | null {
  switch (frequency) {
    case 'daily':
      return new Date(current.getTime() + DAY_MS);
    case 'weekly':
      return new Date(current.getTime() + 7 * DAY_MS);
    case 'monthly':
      return addMonthsUTC(current, 1);
    case 'quarterly':
      return addMonthsUTC(current, 3);
    case 'yearly':
      return addMonthsUTC(current, 12);
  }
}

/**
 * Month arithmetic on an instant, clamping to the last valid day.
 * Using UTC keeps the recurrence stable regardless of the reporting timezone;
 * the instant is only ever used for ordering, and the projection is bucketed in
 * the reporting timezone afterwards.
 */
function addMonthsUTC(instant: Date, months: number): Date {
  const year = instant.getUTCFullYear();
  const month = instant.getUTCMonth();
  const day = instant.getUTCDate();
  const targetMonthStart = Date.UTC(year, month + months, 1);
  const daysInTargetMonth = new Date(
    Date.UTC(new Date(targetMonthStart).getUTCFullYear(), new Date(targetMonthStart).getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(
    Date.UTC(
      new Date(targetMonthStart).getUTCFullYear(),
      new Date(targetMonthStart).getUTCMonth(),
      clampedDay,
      instant.getUTCHours(),
      instant.getUTCMinutes(),
      instant.getUTCSeconds(),
    ),
  );
}

/**
 * Every occurrence of a recurring expense inside the horizon.
 *
 * Bounded by `MAX_RECURRING_OCCURRENCES` so a malformed record with a daily
 * frequency and no end date cannot make the engine spin.
 */
export function occurrencesInHorizon(
  expense: RecurringExpenseInput,
  horizon: HalfOpenPeriod,
): Date[] {
  const occurrences: Date[] = [];
  let cursor = expense.nextDueDate;
  while (
    cursor.getTime() < horizon.to.getTime() &&
    occurrences.length < MAX_RECURRING_OCCURRENCES
  ) {
    if (expense.endDate !== null && cursor.getTime() > expense.endDate.getTime()) break;
    if (cursor.getTime() >= horizon.from.getTime()) occurrences.push(cursor);
    const next = nextOccurrence(cursor, expense.frequency);
    if (next === null || next.getTime() <= cursor.getTime()) break;
    cursor = next;
  }
  return occurrences;
}

// ---------------------------------------------------------------------------
// Item construction
// ---------------------------------------------------------------------------

export function buildItem(input: {
  category: CashFlowCategory;
  amount: number;
  description: string;
  confidence: CashFlowItem['confidence'];
  sourceId: string;
  sourceType: CashFlowSourceType;
  assumptionBased?: boolean;
}): CashFlowItem {
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    throw new RangeError(
      `Cash-flow item amount must be a non-negative integer, got ${input.amount}.`,
    );
  }
  return {
    category: input.category,
    amount: roundHalfAwayFromZero(input.amount),
    description: input.description,
    confidence: input.confidence,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    assumptionBased: input.assumptionBased === true,
  };
}

// ---------------------------------------------------------------------------
// Assumptions and coverage
// ---------------------------------------------------------------------------

/** Gaps that are structural in the schema and can never be closed by projection. */
export const STRUCTURAL_GAPS: readonly string[] = [
  'Loan repayments are not represented in the data model and are not projected.',
  'Tax payments are projected only when an expense record for them exists.',
  'Discretionary stock purchases are not projected.',
  'Opening cash is ledger-derived and is not reconciled against a bank balance.',
];

export function buildCoverage(input: {
  items: readonly CashFlowItem[];
  periodsOfHistory: number;
  historicalWindowDays: number;
}): ForecastCoverage {
  const total = sumMinorUnits(
    input.items.map((item) => item.amount),
  );
  const backed = sumMinorUnits(
    input.items.filter((item) => !item.assumptionBased).map((item) => item.amount),
  );
  const coverageBps = ratioBps(backed, total) ?? 0;
  const hasEnoughHistory = input.periodsOfHistory >= MIN_HISTORY_PERIODS;

  return {
    coverageBps: clamp(coverageBps, 0, 10_000),
    historicalWindowDays: input.historicalWindowDays,
    periodsOfHistory: input.periodsOfHistory,
    hasEnoughHistory,
    quality: total === 0 ? 'insufficient_data' : coverageBps === 0 ? 'partial' : 'complete',
    knownGaps: total === 0 ? [...STRUCTURAL_GAPS, 'No dated obligations or history are available.'] : [...STRUCTURAL_GAPS],
  };
}

export function buildAssumption(input: {
  id: string;
  statement: string;
  category: CashFlowCategory;
  amountMinor: number;
  totalMinor: number;
  limitation: string;
}): ForecastAssumption {
  return {
    id: input.id,
    statement: input.statement,
    category: input.category,
    shareBps: ratioBps(input.amountMinor, input.totalMinor),
    limitation: input.limitation,
  };
}

// ---------------------------------------------------------------------------
// Risk detection
// ---------------------------------------------------------------------------

export function detectNegativeBalance(period: CashFlowPeriod): CashFlowRisk | null {
  if (period.runningBalance >= 0) return null;
  return {
    type: 'negative_balance',
    severity: 'critical',
    periodStart: period.periodStart,
    description:
      `Projected balance of ${Math.abs(period.runningBalance)} minor units ` +
      `at the end of the period beginning ${period.periodStart.toISOString()}.`,
    projectedShortfall: Math.abs(period.runningBalance),
    contributingFactors: topOutflowCategories(period.outflows),
    relatedIds: [],
  };
}

/**
 * Balance below the one-week-outflow buffer.
 * Severity is `warning`, never `critical`: running out of buffer is a signal to
 * act, running negative is the failure itself and is handled above.
 */
export function detectLowBalance(
  period: CashFlowPeriod,
  thresholdMinor: number,
): CashFlowRisk | null {
  if (thresholdMinor <= 0) return null;
  if (period.runningBalance < 0 || period.runningBalance >= thresholdMinor) return null;
  return {
    type: 'low_balance',
    severity: 'warning',
    periodStart: period.periodStart,
    description:
      `Projected balance of ${period.runningBalance} minor units is below the ` +
      `low-balance buffer of ${thresholdMinor} minor units.`,
    contributingFactors: topOutflowCategories(period.outflows),
    relatedIds: [],
  };
}

/**
 * One bucket's outflows are a large multiple of the typical bucket.
 *
 * Compared against the median rather than the mean so a single genuine spike
 * does not raise the baseline and mask itself.
 */
export function detectPaymentSpike(
  periods: readonly CashFlowPeriod[],
): CashFlowRisk | null {
  const outflowTotals = periods.map((period) =>
    sumMinorUnits(period.outflows.map((item) => item.amount)),
  );
  const baseline = median(outflowTotals);
  if (baseline === undefined || baseline <= 0) return null;

  let worst: { period: CashFlowPeriod; total: number; index: number } | undefined;
  outflowTotals.forEach((total, index) => {
    const period = periods[index];
    if (!period) return;
    if (total >= baseline * PAYMENT_SPIKE_MULTIPLIER && (!worst || total > worst.total)) {
      worst = { period, total, index };
    }
  });
  if (!worst) return null;

  const period = worst.period;
  return {
    type: 'payment_spike',
    severity: 'warning',
    periodStart: period.periodStart,
    description:
      `Projected outflows of ${worst.total} minor units in this period are more than ` +
      `${PAYMENT_SPIKE_MULTIPLIER}x the typical period outflow of ${baseline} minor units.`,
    contributingFactors: topOutflowCategories(period.outflows),
    relatedIds: period.outflows
      .filter((item) => item.sourceType === 'payable' || item.sourceType === 'expense')
      .map((item) => item.sourceId ?? '')
      .filter((id) => id.length > 0)
      .slice(0, 20),
  };
}

/**
 * A single counterparty holds more than half of the horizon's receivables or
 * payables. Concentration of that kind means one late payment can break the
 * forecast, which is a different risk from the amount being late.
 */
export function detectHighConcentration(
  obligations: readonly ObligationInput[],
  totalMinor: number,
  direction: 'inflow' | 'outflow',
): CashFlowRisk | null {
  if (obligations.length < 2 || totalMinor <= 0) return null;
  const shareBps = ratioBps(maxOf(obligations.map((o) => o.openMinor)) ?? 0, totalMinor);
  // Strictly greater than half: an even split is not a concentration risk.
  if (shareBps === undefined || shareBps <= CONCENTRATION_RISK_BPS) return null;

  const largest = obligations.reduce((best, current) =>
    current.openMinor > best.openMinor ? current : best,
  );
  return {
    type: 'high_concentration',
    severity: 'warning',
    periodStart: obligations[0]?.dueDate ?? new Date(0),
    description:
      `${largest.counterpartyName} accounts for ${shareBps / 100}% of projected ` +
      `${direction === 'inflow' ? 'receivables' : 'payables'} in this horizon.`,
    contributingFactors: [direction],
    relatedIds: [largest.id],
  };
}

function topOutflowCategories(items: readonly CashFlowItem[]): string[] {
  const ranked = [...items].sort((a, b) => b.amount - a.amount).map((item) => item.category);
  return [...new Set(ranked)].slice(0, 3);
}

// ---------------------------------------------------------------------------
// Engine entry points
// ---------------------------------------------------------------------------

/** Materials one bucket's totals into an immutable period. */
export function buildCashFlowPeriod(bucket: CashBucket): CashFlowPeriod {
  const inflows = bucket.inflows.slice().sort(byAmountThenSource);
  const outflows = bucket.outflows.slice().sort(byAmountThenSource);
  return {
    periodStart: bucket.period.from,
    periodEnd: bucket.period.to,
    inflows,
    outflows,
    netFlow: calculateNetFlow(inflows, outflows),
    runningBalance: 0,
  };
}

/**
 * Carries the balance forward across buckets.
 *
 * Mutates a copy, not its input, so the same bucket list can be projected twice
 * with different opening balances.
 */
export function applyRunningBalances(
  periods: readonly CashFlowPeriod[],
  openingBalanceMinor: number,
): CashFlowPeriod[] {
  let running = openingBalanceMinor;
  return periods.map((period) => {
    const next = running + period.netFlow;
    running = next;
    return { ...period, runningBalance: next };
  });
}

/** Every risk signal for a completed projection, in severity order. */
export function collectRisks(input: {
  periods: readonly CashFlowPeriod[];
  receivables: readonly ObligationInput[];
  payables: readonly ObligationInput[];
  averageMonthlyOutflowMinor: number;
  openingBalanceSource: OpeningBalanceSource;
}): CashFlowRisk[] {
  const risks: (CashFlowRisk | null)[] = [];
  const threshold = calculateLowBalanceThreshold(input.averageMonthlyOutflowMinor);

  for (const period of input.periods) {
    risks.push(detectNegativeBalance(period), detectLowBalance(period, threshold));
  }
  risks.push(detectPaymentSpike(input.periods));
  // Narrow the nullable detectors in one place so callers get a dense list.
  const dense: CashFlowRisk[] = risks.filter((risk): risk is CashFlowRisk => risk !== null);

  const receivableTotal = sumMinorUnits(input.receivables.map((o) => o.openMinor));
  const payableTotal = sumMinorUnits(input.payables.map((o) => o.openMinor));
  dense.push(
    ...[detectHighConcentration(input.receivables, receivableTotal, 'inflow')].filter(
      (risk): risk is CashFlowRisk => risk !== null,
    ),
    ...[detectHighConcentration(input.payables, payableTotal, 'outflow')].filter(
      (risk): risk is CashFlowRisk => risk !== null,
    ),
  );

  if (input.openingBalanceSource === 'unavailable') {
    dense.push({
      type: 'negative_balance',
      severity: 'info',
      periodStart: input.periods[0]?.periodStart ?? new Date(0),
      description:
        'Opening cash could not be derived from the ledger, so balances in this projection are not reliable.',
      contributingFactors: ['unreconciled_opening_balance'],
      relatedIds: [],
    });
  }

  return dense.sort(bySeverityThenDate);
}

function byAmountThenSource(a: CashFlowItem, b: CashFlowItem): number {
  return b.amount - a.amount || (a.sourceId ?? '').localeCompare(b.sourceId ?? '');
}

function bySeverityThenDate(a: CashFlowRisk, b: CashFlowRisk): number {
  const order = { critical: 0, warning: 1, info: 2 } as const;
  return order[a.severity] - order[b.severity] || a.periodStart.getTime() - b.periodStart.getTime();
}

/** Mean inflow per historical period, or `undefined` when there is no history. */
export function meanHistoricalInflow(
  history: CashFlowInputs['historicalInflows'],
): number | undefined {
  if (history.length === 0) return undefined;
  return roundHalfAwayFromZero(sumMinorUnits(history.map((entry) => entry.inflowMinor)) / history.length);
}