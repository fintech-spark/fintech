import { createMoney, type CurrencyCode } from '@/lib/types';
import { changeBps, marginBps, roundHalfAwayFromZero } from './numeric';
import type { FinancialSnapshot, MetricName } from './types';

// The five functions below are the module's published contract and predate the
// snapshot pipeline. Their signatures and return conventions are preserved
// exactly; the snapshot-aware variants at the bottom of this file are preferred
// for new code because they distinguish "zero" from "unknown".

/** grossProfit = revenue - cogs, in minor units. May be negative. */
export function calculateGrossProfit(revenue: number, cogs: number): number {
  return revenue - cogs;
}

/** netProfit = grossProfit - operatingExpenses, in minor units. May be negative. */
export function calculateNetProfit(grossProfit: number, operatingExpenses: number): number {
  return grossProfit - operatingExpenses;
}

/**
 * Margin in bps, reporting `0` when revenue is zero.
 *
 * Kept for contract compatibility. New code should read `grossMarginBps` from a
 * `FinancialSnapshot` together with `unavailableMetrics`, because a `0` here
 * cannot distinguish "no revenue" from "revenue but zero profit".
 */
export function calculateMarginBps(profit: number, revenue: number): number {
  if (revenue === 0) return 0;
  return Math.round((profit / revenue) * 10_000);
}

/**
 * cashPosition = currentCash + receivables - payables, in minor units.
 *
 * This is the repository's working definition of available cash including money
 * owed to the merchant, net of money the merchant owes.
 */
export function calculateCashPosition(
  currentCash: number,
  receivables: number,
  payables: number,
): number {
  return currentCash + receivables - payables;
}

/**
 * Period-over-period change in bps.
 *
 * Legacy contract: a zero baseline yields 10_000 for any positive current value
 * and `0` otherwise. New code should use `periodChangeBps`, which returns
 * `undefined` for a zero baseline because no growth rate is defined there.
 */
export function calculateChangeBps(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 10_000 : 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000);
}

// ---------------------------------------------------------------------------
// Snapshot-aware variants
// ---------------------------------------------------------------------------

/**
 * Period-over-period change in bps, signed. `undefined` when the baseline is
 * zero, which callers must surface as an unavailable percentage change rather
 * than substituting a value.
 */
export function periodChangeBps(current: number, previous: number): number | undefined {
  return changeBps(current, previous);
}

/** Margin in bps, `undefined` when revenue is zero. */
export function snapshotMarginBps(profit: number, revenue: number): number | undefined {
  return marginBps(profit, revenue);
}

/** Currency of a snapshot's figures, defaulting to the product default. */
export function snapshotCurrency(currency: string | null | undefined): CurrencyCode {
  return currency === 'USD' || currency === 'EUR' || currency === 'GBP' ? currency : 'INR';
}

/**
 * Assembles a `FinancialSnapshot` from already-computed inputs.
 *
 * Kept separate from persistence so the arithmetic is testable without a
 * database and identical whether produced by the SQL repository or an in-memory
 * adapter.
 */
export function buildFinancialSnapshot(input: {
  readonly businessId: FinancialSnapshot['businessId'];
  readonly period: FinancialSnapshot['period'];
  readonly currency: string;
  readonly revenueMinor: number;
  readonly cogsMinor: number;
  readonly operatingExpensesMinor: number;
  readonly inventoryValueMinor: number;
  readonly totalReceivablesMinor: number;
  readonly totalPayablesMinor: number;
  readonly cashMinor: number;
  readonly revenueRecognition: FinancialSnapshot['revenueRecognition'];
  readonly cogsRecognition: FinancialSnapshot['cogsRecognition'];
  readonly expenseBreakdown: FinancialSnapshot['expenseBreakdown'];
  readonly openReceivablesCount: number;
  readonly overdueReceivablesMinor: number;
  readonly openPayablesCount: number;
  readonly productCount: number;
  readonly calculatedAt: Date;
}): FinancialSnapshot {
  const currency = snapshotCurrency(input.currency);
  const grossProfitMinor = calculateGrossProfit(input.revenueMinor, input.cogsMinor);
  const netProfitMinor = calculateNetProfit(grossProfitMinor, input.operatingExpensesMinor);

  const unavailable: MetricName[] = [...input.revenueRecognition.unavailableMetrics];
  if (input.cogsRecognition.quality !== 'complete') {
    unavailable.push('cogs', 'gross_profit', 'gross_margin', 'net_profit', 'net_margin');
  }

  const quality = resolveSnapshotQuality(input.cogsRecognition.quality, unavailable);

  return {
    businessId: input.businessId,
    period: input.period,
    revenue: createMoney(input.revenueMinor, currency),
    cogs: createMoney(input.cogsMinor, currency),
    grossProfit: createMoney(grossProfitMinor, currency),
    grossMarginBps: calculateMarginBps(grossProfitMinor, input.revenueMinor),
    operatingExpenses: createMoney(input.operatingExpensesMinor, currency),
    netProfit: createMoney(netProfitMinor, currency),
    netMarginBps: calculateMarginBps(netProfitMinor, input.revenueMinor),
    inventoryValue: createMoney(input.inventoryValueMinor, currency),
    totalReceivables: createMoney(input.totalReceivablesMinor, currency),
    totalPayables: createMoney(input.totalPayablesMinor, currency),
    cashPosition: createMoney(
      calculateCashPosition(
        input.cashMinor,
        input.totalReceivablesMinor,
        input.totalPayablesMinor,
      ),
      currency,
    ),
    calculatedAt: input.calculatedAt,
    currency,
    quality,
    unavailableMetrics: [...new Set(unavailable)],
    revenueRecognition: input.revenueRecognition,
    cogsRecognition: input.cogsRecognition,
    expenseBreakdown: input.expenseBreakdown,
    openReceivablesCount: input.openReceivablesCount,
    overdueReceivables: createMoney(input.overdueReceivablesMinor, currency),
    openPayablesCount: input.openPayablesCount,
    productCount: input.productCount,
  };
}

/** Worst quality wins: a period is only `complete` when every part of it is. */
function resolveSnapshotQuality(
  cogsQuality: FinancialSnapshot['cogsRecognition']['quality'],
  unavailable: readonly MetricName[],
): FinancialSnapshot['quality'] {
  if (cogsQuality === 'insufficient_data') return 'insufficient_data';
  if (cogsQuality === 'partial') return 'partial';
  if (unavailable.length > 0) return 'insufficient_data';
  return 'complete';
}

/** Rounds a snapshot figure for presentation without changing stored precision. */
export function roundForDisplay(minorUnits: number): number {
  return roundHalfAwayFromZero(minorUnits);
}