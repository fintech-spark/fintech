// Evidence assembly for the detectors.
//
// Split out of `detectors.ts` to keep both files inside the repository's 800-line
// ceiling. Everything here turns gathered facts into typed evidence entries and the
// derived values a rule needs; none of it decides whether a rule fires.

import { ratioBps } from '@/modules/analytics';
import {
  PRODUCT_MIN_AGE_DAYS,
  SUPPLIER_COST_INCREASE_BPS,
  evidence,
  supplierCostIncreaseImpact,
} from './rules';
import type { LeakEvidence } from './types';
import type { DetectorContext } from './detectors';

export interface CostIncreaseCandidate {
  readonly productId: string;
  readonly productName: string;
  readonly currentPrice: number;
  readonly baselinePrice: number;
  readonly quantitySold: number;
  readonly impactMinor: number;
  readonly evidence: LeakEvidence[];
  readonly inputs: Readonly<Record<string, number>>;
}

/**
 * Products whose weighted purchase price rose while still being sold.
 *
 * Requires the product to appear in both periods' purchase records, so the
 * comparison is like-for-like rather than comparing different products.
 */
export function findCostIncreases(context: DetectorContext): CostIncreaseCandidate[] {
  const candidates: CostIncreaseCandidate[] = [];
  for (const sale of context.productSales) {
    const current = context.purchasePrices.get(sale.productId);
    const previous = context.previousPurchasePrices.get(sale.productId);
    if (!current || !previous) continue;
    if (previous.weightedUnitPriceMinor <= 0) continue;
    const rise = ratioBps(
      current.weightedUnitPriceMinor - previous.weightedUnitPriceMinor,
      previous.weightedUnitPriceMinor,
    );
    if (rise === undefined || rise < SUPPLIER_COST_INCREASE_BPS) continue;

    const impactMinor = supplierCostIncreaseImpact({
      currentWeightedUnitPriceMinor: current.weightedUnitPriceMinor,
      baselineWeightedUnitPriceMinor: previous.weightedUnitPriceMinor,
      quantitySold: sale.quantity,
    });
    if (impactMinor <= 0) continue;

    candidates.push({
      productId: sale.productId,
      productName: sale.name,
      currentPrice: current.weightedUnitPriceMinor,
      baselinePrice: previous.weightedUnitPriceMinor,
      quantitySold: sale.quantity,
      impactMinor,
      evidence: [
        evidence({
          type: 'product',
          resourceId: sale.productId,
          description: `${sale.name}: purchase price rose from ${previous.weightedUnitPriceMinor} to ${current.weightedUnitPriceMinor} minor units per unit.`,
          value: current.weightedUnitPriceMinor,
        }),
        evidence({
          type: 'calculation',
          resourceId: `purchase-price-baseline:${sale.productId}`,
          description: `Baseline weighted purchase price was ${previous.weightedUnitPriceMinor} minor units per unit.`,
          value: previous.weightedUnitPriceMinor,
        }),
        evidence({
          type: 'calculation',
          resourceId: `purchase-price-impact:${sale.productId}`,
          description: `${sale.quantity} unit(s) sold at the higher cost, costing ${impactMinor} minor units.`,
          value: impactMinor,
        }),
      ],
      inputs: {
        currentWeightedUnitPrice: current.weightedUnitPriceMinor,
        baselineWeightedUnitPrice: previous.weightedUnitPriceMinor,
        quantitySold: sale.quantity,
      },
    });
  }
  return candidates.sort((a, b) => b.impactMinor - a.impactMinor);
}

export function buildMarginEvidence(context: DetectorContext): LeakEvidence[] {
  return [
    evidence({
      type: 'calculation',
      resourceId: 'gross-margin-current',
      description:
        `Gross profit of ${context.current.grossProfit.amount} on revenue of ` +
        `${context.current.revenue.amount} gives ${context.current.grossMarginBps} bps.`,
      value: context.current.grossMarginBps,
    }),
    evidence({
      type: 'calculation',
      resourceId: 'gross-margin-baseline',
      description:
        `Gross profit of ${context.previous.grossProfit.amount} on revenue of ` +
        `${context.previous.revenue.amount} gave ${context.previous.grossMarginBps} bps.`,
      value: context.previous.grossMarginBps,
    }),
    evidence({
      type: 'calculation',
      resourceId: 'cogs-comparison',
      description:
        `Cost of goods moved from ${context.previous.cogs.amount} to ${context.current.cogs.amount} minor units.`,
      value: context.current.cogs.amount,
    }),
  ];
}

export function createdAtOf(context: DetectorContext, productId: string): Date {
  return (
    context.products.find((product) => product.id === productId)?.createdAt ??
    new Date(context.detectedAt.getTime() - PRODUCT_MIN_AGE_DAYS_MS)
  );
}

const PRODUCT_MIN_AGE_DAYS_MS = PRODUCT_MIN_AGE_DAYS * 86_400_000;
