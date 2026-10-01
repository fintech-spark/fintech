import type { BusinessId, Money, DateRange } from '@/lib/types';
export interface FinancialSnapshot {
  readonly businessId: BusinessId; readonly period: DateRange; readonly revenue: Money; readonly cogs: Money;
  readonly grossProfit: Money; readonly grossMarginBps: number; readonly operatingExpenses: Money; readonly netProfit: Money;
  readonly netMarginBps: number; readonly inventoryValue: Money; readonly totalReceivables: Money; readonly totalPayables: Money;
  readonly cashPosition: Money; readonly calculatedAt: Date;
}
export interface FinancialMetric { readonly name: MetricName; readonly value: number; readonly previousValue?: number; readonly changeBps?: number; readonly period: DateRange; }
export type MetricName = 'revenue' | 'cogs' | 'gross_profit' | 'net_profit' | 'gross_margin' | 'net_margin' | 'inventory_value' | 'receivables' | 'payables' | 'cash_position' | 'transaction_count' | 'average_order_value';
