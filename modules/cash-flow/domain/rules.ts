import type { CashFlowPeriod, CashFlowRisk } from './types';
export function calculateNetFlow(inflows: readonly { amount: number }[], outflows: readonly { amount: number }[]): number {
  return inflows.reduce((sum, i) => sum + i.amount, 0) - outflows.reduce((sum, o) => sum + o.amount, 0);
}
export function detectNegativeBalance(period: CashFlowPeriod): CashFlowRisk | null {
  if (period.runningBalance < 0) {
    return {
      type: 'negative_balance',
      severity: 'critical',
      periodStart: period.periodStart,
      description: `Projected negative balance of ${Math.abs(period.runningBalance)} minor units`,
      projectedShortfall: Math.abs(period.runningBalance),
      contributingFactors: Array.from(period.outflows).sort((a, b) => b.amount - a.amount).slice(0, 3).map((o) => o.category),
    };
  }
  return null;
}
export function calculateLowBalanceThreshold(averageMonthlyOutflow: number): number { return Math.round(averageMonthlyOutflow * 0.1); }
