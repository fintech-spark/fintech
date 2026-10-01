import type { TenantContext, DateRange } from '@/lib/types';
import type { CashFlowForecast, CashFlowRisk } from '../domain/types';
export interface CashFlowService {
  forecast(ctx: TenantContext, period: DateRange): Promise<CashFlowForecast>;
  getRisks(ctx: TenantContext): Promise<readonly CashFlowRisk[]>;
  getLatestForecast(ctx: TenantContext): Promise<CashFlowForecast | null>;
}
