import type { BusinessId } from '@/lib/types';
export interface Scenario {
  readonly id: string; readonly businessId: BusinessId; readonly name: string; readonly description?: string;
  readonly parameters: readonly ScenarioParameter[]; readonly baseline: ScenarioSnapshot; readonly projected: ScenarioSnapshot;
  readonly comparison: ScenarioComparison; readonly status: ScenarioStatus; readonly createdAt: Date;
}
export type ScenarioStatus = 'draft' | 'calculated' | 'expired';
export interface ScenarioParameter { readonly type: ParameterType; readonly targetId?: string; readonly targetName?: string; readonly currentValue: number; readonly newValue: number; readonly unit: 'amount' | 'percentage' | 'quantity' | 'days'; }
export type ParameterType = 'price_change' | 'quantity_change' | 'discount_change' | 'cost_change' | 'expense_change' | 'payment_timing' | 'inventory_order';
export interface ScenarioSnapshot { readonly revenue: number; readonly cogs: number; readonly grossProfit: number; readonly grossMarginBps: number; readonly operatingExpenses: number; readonly netProfit: number; readonly netMarginBps: number; }
export interface ScenarioComparison { readonly revenueDelta: number; readonly profitDelta: number; readonly marginDeltaBps: number; readonly summary: string; }
