import type { TenantContext, DateRange } from '@/lib/types';
import type { FinancialSnapshot, FinancialMetric, MetricName } from '../domain/types';
export interface AnalyticsService {
  getSnapshot(ctx: TenantContext, period: DateRange): Promise<FinancialSnapshot>;
  getMetric(ctx: TenantContext, metric: MetricName, period: DateRange): Promise<FinancialMetric>;
  getDashboardMetrics(ctx: TenantContext, period: DateRange): Promise<readonly FinancialMetric[]>;
  getRevenueBreakdown(ctx: TenantContext, period: DateRange): Promise<readonly BreakdownItem[]>;
  getExpenseBreakdown(ctx: TenantContext, period: DateRange): Promise<readonly BreakdownItem[]>;
}
export interface BreakdownItem { readonly category: string; readonly amount: number; readonly percentage: number; readonly count: number; }
