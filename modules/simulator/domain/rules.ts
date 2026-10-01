import type { ScenarioSnapshot, ScenarioComparison, ScenarioParameter } from './types';
export function applyPriceChange(currentRevenue: number, changeBps: number): number { return Math.round(currentRevenue * (1 + changeBps / 10_000)); }
export function applyCostChange(currentCogs: number, changeBps: number): number { return Math.round(currentCogs * (1 + changeBps / 10_000)); }
export function compareSnapshots(baseline: ScenarioSnapshot, projected: ScenarioSnapshot): ScenarioComparison {
  const profitDelta = projected.netProfit - baseline.netProfit;
  const direction = profitDelta > 0 ? 'increase' : profitDelta < 0 ? 'decrease' : 'no change';
  return { revenueDelta: projected.revenue - baseline.revenue, profitDelta, marginDeltaBps: projected.netMarginBps - baseline.netMarginBps, summary: `Projected net profit ${direction} of ${Math.abs(profitDelta)} minor units` };
}
export function validateParameterBounds(param: ScenarioParameter): boolean {
  if (param.unit === 'percentage') return Math.abs(param.newValue - param.currentValue) <= 10_000;
  return param.newValue >= 0;
}
