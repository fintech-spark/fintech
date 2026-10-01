import type { BusinessId, Money, DateRange } from '@/lib/types';
export interface CashFlowForecast {
  readonly id: string; readonly businessId: BusinessId; readonly period: DateRange; readonly periods: readonly CashFlowPeriod[];
  readonly startingCash: Money; readonly endingCash: Money; readonly risks: readonly CashFlowRisk[]; readonly calculatedAt: Date;
}
export interface CashFlowPeriod { readonly periodStart: Date; readonly periodEnd: Date; readonly inflows: readonly CashFlowItem[]; readonly outflows: readonly CashFlowItem[]; readonly netFlow: number; readonly runningBalance: number; }
export interface CashFlowItem { readonly category: CashFlowCategory; readonly amount: number; readonly description: string; readonly confidence: 'actual' | 'expected' | 'projected'; readonly sourceId?: string; }
export type CashFlowCategory = 'sales_revenue' | 'collections' | 'other_income' | 'supplier_payments' | 'operating_expenses' | 'salaries' | 'rent' | 'taxes' | 'loan_payments' | 'planned_purchases' | 'other_expenses';
export interface CashFlowRisk { readonly type: RiskType; readonly severity: 'critical' | 'warning' | 'info'; readonly periodStart: Date; readonly description: string; readonly projectedShortfall?: number; readonly contributingFactors: readonly string[]; }
export type RiskType = 'negative_balance' | 'low_balance' | 'high_concentration' | 'payment_spike';
