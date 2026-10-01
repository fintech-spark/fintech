export function calculateGrossProfit(revenue: number, cogs: number): number { return revenue - cogs; }
export function calculateNetProfit(grossProfit: number, operatingExpenses: number): number { return grossProfit - operatingExpenses; }
export function calculateMarginBps(profit: number, revenue: number): number { if (revenue === 0) return 0; return Math.round((profit / revenue) * 10_000); }
export function calculateCashPosition(currentCash: number, receivables: number, payables: number): number { return currentCash + receivables - payables; }
export function calculateChangeBps(current: number, previous: number): number { if (previous === 0) return current > 0 ? 10_000 : 0; return Math.round(((current - previous) / Math.abs(previous)) * 10_000); }
