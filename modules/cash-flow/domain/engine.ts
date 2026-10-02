import {
  buildCoverage,
  buildAssumption,
  buildCashFlowPeriod,
  buildItem,
  applyRunningBalances,
  bucketForDate,
  categoryForExpense,
  collectRisks,
  meanHistoricalInflow,
  occurrencesInHorizon,
  MIN_HISTORY_PERIODS,
  type CashBucket,
} from './rules';
import type {
  CashFlowAssumptions,
  CashFlowInputs,
  CashFlowItem,
  CashFlowPeriod,
  CashFlowProjection,
  ForecastAssumption,
  OpeningBalanceSource,
} from './types';
import { sumMinorUnits, type HalfOpenPeriod } from '@/modules/analytics';

/**
 * Projection assembly.
 *
 * Separated from `rules.ts` so the arithmetic primitives stay independently
 * testable while this file holds the orchestration of one projection run. Still
 * pure: it takes gathered facts and returns a projection, with no clock, no I/O
 * and no randomness.
 */

/** Builds empty buckets covering a horizon, in chronological order. */
export function createBuckets(buckets: readonly HalfOpenPeriod[]): CashBucket[] {
  return buckets.map((period) => ({ period, inflows: [], outflows: [] }));
}

/**
 * Places dated obligations and expenses into their buckets.
 *
 * Anything due before the horizon start goes into the first bucket: overdue money
 * still moves, and dropping it would understate the merchant's exposure.
 * Anything due after the horizon end is ignored, because it cannot affect any
 * balance inside the horizon.
 */
export function distributeDatedItems(
  buckets: CashBucket[],
  inputs: CashFlowInputs,
): void {
  for (const receivable of inputs.receivables) {
    addInflow(buckets, receivable);
  }
  for (const payable of inputs.payables) {
    addOutflow(buckets, payable);
  }
  for (const expense of inputs.datedExpenses) {
    const bucket = bucketForDate(buckets, expense.expenseDate);
    if (!bucket) continue;
    target(buckets, bucket).outflows.push(
      buildItem({
        category: categoryForExpense(expense.category),
        amount: expense.amountMinor,
        description: `${expense.category} expense dated ${expense.expenseDate.toISOString().slice(0, 10)}`,
        confidence: 'expected',
        sourceId: expense.id,
        sourceType: 'expense',
      }),
    );
  }
  for (const expense of inputs.recurringExpenses) {
    distributeRecurring(buckets, expense, inputs.horizon);
  }
}

function addInflow(
  buckets: CashBucket[],
  receivable: CashFlowInputs['receivables'][number],
): void {
  const bucket = bucketForDate(buckets, receivable.dueDate);
  if (!bucket) return;
  const overdue = receivable.daysOverdue > 0;
  target(buckets, bucket).inflows.push(
    buildItem({
      category: 'collections',
      amount: receivable.openMinor,
      description: overdue
        ? `Collection from ${receivable.counterpartyName} (${receivable.daysOverdue} day(s) overdue)`
        : `Collection from ${receivable.counterpartyName}`,
      confidence: 'expected',
      sourceId: receivable.id,
      sourceType: 'receivable',
    }),
  );
}

function addOutflow(
  buckets: CashBucket[],
  payable: CashFlowInputs['payables'][number],
): void {
  const bucket = bucketForDate(buckets, payable.dueDate);
  if (!bucket) return;
  const overdue = payable.daysOverdue > 0;
  target(buckets, bucket).outflows.push(
    buildItem({
      category: 'supplier_payments',
      amount: payable.openMinor,
      description: overdue
        ? `Payment to ${payable.counterpartyName} (${payable.daysOverdue} day(s) overdue)`
        : `Payment to ${payable.counterpartyName}`,
      confidence: 'expected',
      sourceId: payable.id,
      sourceType: 'payable',
    }),
  );
}

/**
 * Expands a recurring expense across the horizon.
 *
 * Occurrences beyond the first are derived from the stored frequency rather than
 * read from a record, which is why every derived occurrence is flagged
 * `assumptionBased` and dilutes the coverage score.
 */
function distributeRecurring(
  buckets: CashBucket[],
  expense: CashFlowInputs['recurringExpenses'][number],
  horizon: HalfOpenPeriod,
): void {
  const occurrences = occurrencesInHorizon(expense, horizon);
  occurrences.forEach((occurrence, index) => {
    const bucket = bucketForDate(buckets, occurrence);
    if (!bucket) return;
    target(buckets, bucket).outflows.push(
      buildItem({
        category: categoryForExpense(expense.category),
        amount: expense.amountMinor,
        description: `${expense.category} (${expense.frequency}) due ${occurrence
          .toISOString()
          .slice(0, 10)}`,
        confidence: 'expected',
        sourceId: expense.id,
        sourceType: 'recurring_expense',
        assumptionBased: index > 0,
      }),
    );
  });
}

/**
 * Adds an extrapolated sales line to each bucket, but only when there is enough
 * history to justify it.
 *
 * With fewer than `MIN_HISTORY_PERIODS` prior periods the projection contains no
 * sales line at all and records the omission as an explicit assumption. A missing
 * forecast is more honest than a fabricated one.
 */
export function applyHistoricalInflows(
  buckets: CashBucket[],
  inputs: CashFlowInputs,
): { projectedMinor: number; assumption: ForecastAssumption | undefined } {
  const mean = meanHistoricalInflow(inputs.historicalInflows);
  if (mean === undefined || inputs.historicalInflows.length < MIN_HISTORY_PERIODS) {
    return { projectedMinor: 0, assumption: undefined };
  }

  let projectedMinor = 0;
  for (const bucket of buckets) {
    const scaled = scaleMeanToBucket(mean, bucket.period, inputs.historicalInflows);
    projectedMinor += scaled;
    bucket.inflows.push(
      buildItem({
        category: 'sales_revenue',
        amount: scaled,
        description: 'Projected sales revenue from historical average',
        confidence: 'projected',
        sourceId: 'historical-average-sales',
        sourceType: 'historical_average',
        assumptionBased: true,
      }),
    );
  }

  const total = sumMinorUnits(buckets.flatMap((bucket) => bucket.outflows.map((i) => i.amount)));
  return {
    projectedMinor,
    assumption: buildAssumption({
      id: 'sales-revenue-historical-average',
      statement:
        `Sales revenue is projected at the mean of the last ${inputs.historicalInflows.length} ` +
        'complete periods, with no growth or seasonality adjustment.',
      category: 'sales_revenue',
      amountMinor: projectedMinor,
      totalMinor: total + projectedMinor,
      limitation:
        'A merchant whose sales are trending, seasonal, or newly changed will see a projection ' +
        'that overstates or understates reality. Replace it with a dated forecast when available.',
    }),
  };
}

/**
 * Scales a historical mean to a bucket's length.
 *
 * Bucket lengths differ (a 7-day bucket inside a 5-week horizon, for example),
 * so an unscaled mean would systematically over- or under-state a bucket.
 */
export function scaleMeanToBucket(
  meanPerPeriodMinor: number,
  bucket: HalfOpenPeriod,
  history: readonly { from: Date; to: Date }[],
): number {
  if (history.length === 0) return 0;
  const totalHistoryDays = history.reduce(
    (days, entry) => days + (entry.to.getTime() - entry.from.getTime()) / 86_400_000,
    0,
  );
  if (totalHistoryDays <= 0) return 0;
  const bucketDays = (bucket.to.getTime() - bucket.from.getTime()) / 86_400_000;
  const historyLengthDays = history[0]
    ? (history[0].to.getTime() - history[0].from.getTime()) / 86_400_000
    : 0;
  if (historyLengthDays <= 0) return meanPerPeriodMinor;
  const perDay = meanPerPeriodMinor / historyLengthDays;
  return Math.max(0, Math.round(perDay * bucketDays));
}

/** Projects cash movement across a horizon from gathered facts. */
export function projectCashFlow(input: {
  buckets: CashBucket[];
  inputs: CashFlowInputs;
  openingBalanceMinor: number;
  openingBalanceSource: OpeningBalanceSource;
}): CashFlowProjection {
  const historical = applyHistoricalInflows(input.buckets, input.inputs);

  const periods = applyRunningBalances(
    input.buckets.map(buildCashFlowPeriod),
    input.openingBalanceMinor,
  );
  const items = input.buckets.flatMap((bucket) => [...bucket.inflows, ...bucket.outflows]);
  const coverage = buildCoverage({
    items,
    periodsOfHistory: input.inputs.historicalInflows.length,
    historicalWindowDays: input.inputs.historicalWindowDays,
  });
  const assumptions = collectAssumptions(historical.assumption, input.inputs, coverage);
  const risks = collectRisks({
    periods,
    receivables: input.inputs.receivables,
    payables: input.inputs.payables,
    averageMonthlyOutflowMinor: averageMonthlyOutflow(periods),
    openingBalanceSource: input.openingBalanceSource,
  });

  const endingCashMinor = periods[periods.length - 1]?.runningBalance ?? input.openingBalanceMinor;

  return {
    periods,
    openingBalanceMinor: input.openingBalanceMinor,
    endingCashMinor,
    assumptions,
    coverage,
    risks,
  };
}

/**
 * Every assumption the projection makes, always non-empty.
 *
 * When sales are not projected the reason is recorded rather than left implicit,
 * so a consumer can always answer "what did this assume?".
 */
function collectAssumptions(
  salesAssumption: ForecastAssumption | undefined,
  inputs: CashFlowInputs,
  coverage: ReturnType<typeof buildCoverage>,
): CashFlowAssumptions {
  const assumptions: ForecastAssumption[] = [
    // Always present: even a fully obligation-backed projection rests on those
    // obligations actually settling on their recorded due dates. That is an
    // assumption, not a fact, and a projection that omitted it would be
    // presenting a forecast as a certainty.
    buildAssumption({
      id: 'obligations-settle-on-due-date',
      statement:
        'Every receivable and payable is assumed to settle in full on its recorded due date.',
      category: 'collections',
      amountMinor: 0,
      totalMinor: 0,
      limitation:
        'No collection behaviour is modelled. A customer who pays late, or not at all, will push the ' +
        'projected balance lower than shown.',
    }),
  ];
  if (salesAssumption) assumptions.push(salesAssumption);
  else if (inputs.recurringExpenses.length > 0) {
    assumptions.push(
      buildAssumption({
        id: 'recurring-expense-derivation',
        statement:
          'Only the first occurrence of each recurring expense is read from a record; later ' +
          'occurrences are derived from its stored frequency.',
        category: 'operating_expenses',
        amountMinor: 0,
        totalMinor: 0,
        limitation: 'A merchant who changes or cancels a recurring expense will see stale outflows.',
      }),
    );
  }
  if (inputs.openingBalanceSource === 'unavailable') {
    assumptions.push(
      buildAssumption({
        id: 'opening-balance-unavailable',
        statement: 'Opening cash could not be derived, so projected balances are not reliable.',
        category: 'sales_revenue',
        amountMinor: 0,
        totalMinor: 0,
        limitation: 'Every balance figure in this projection is unusable until a cash record exists.',
      }),
    );
  }
  if (coverage.coverageBps < 10_000) {
    assumptions.push(
      buildAssumption({
        id: 'partial-coverage',
        statement:
          `Only ${(coverage.coverageBps / 100).toFixed(1)}% of projected magnitude is backed by a ` +
          'dated obligation.',
        category: 'sales_revenue',
        amountMinor: 0,
        totalMinor: 0,
        limitation: 'Treat the projected balance as an indicator, not a promise.',
      }),
    );
  }
  return assumptions;
}

/**
 * Mean monthly outflow over the projected horizon, used to size the low-balance
 * buffer. Derived from the horizon's real day span rather than a bucket count,
 * so weekly and monthly projections produce a comparable buffer.
 */
export function averageMonthlyOutflow(periods: readonly CashFlowPeriod[]): number {
  if (periods.length === 0) return 0;
  const total = sumMinorUnits(
    periods.flatMap((period) => period.outflows.map((item) => item.amount)),
  );
  const horizonDays =
    (periods[periods.length - 1]!.periodEnd.getTime() - periods[0]!.periodStart.getTime()) /
    86_400_000;
  if (horizonDays <= 0) return 0;
  return Math.round(total * (30 / horizonDays));
}

/** Total of a category's projected lines, for dashboards and tests. */
export function totalForCategory(
  periods: readonly CashFlowPeriod[],
  category: CashFlowItem['category'],
): number {
  return sumMinorUnits(
    periods
      .flatMap((period) => [...period.inflows, ...period.outflows])
      .filter((item) => item.category === category)
      .map((item) => item.amount),
  );
}

/** Resolves a bucket reference to the mutable bucket the engine fills. */
function target(buckets: CashBucket[], found: { period: HalfOpenPeriod }): CashBucket {
  const match = buckets.find((bucket) => bucket.period === found.period);
  if (!match) {
    throw new Error('Bucket resolution failed; this is an internal engine invariant.');
  }
  return match;
}