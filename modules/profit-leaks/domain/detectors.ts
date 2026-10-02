import {
  ratioBps,
  roundHalfAwayFromZero,
  weightedAverageMinorUnits,
  type HalfOpenPeriod,
} from '@/modules/analytics';
import type { FinancialSnapshot } from '@/modules/analytics';
import type {
  LeakCategory,
  LeakCalculation,
  LeakEvidence,
  ProfitLeak,
  SuppressedDetector,
  SuppressionReason,
  UnavailableDetector,
} from './types';
import {
  ABNORMAL_EXPENSE_MIN_INCREASE_MINOR,
  ABNORMAL_EXPENSE_MULTIPLIER,
  DEAD_INVENTORY_DAYS,
  DEAD_INVENTORY_MIN_VALUE_MINOR,
  DISCOUNT_RATE_FLOOR_BPS,
  DISCOUNT_RATE_RISE_BPS,
  LOW_MARGIN_FLOOR_BPS,
  MARGIN_COMPRESSION_BPS,
  MIN_SAMPLE_SIZE,
  PRODUCT_MIN_AGE_DAYS,
  SUPPLIER_COST_INCREASE_BPS,
  abnormalExpenseImpact,
  clampImpact,
  classifySeverity,
  deadInventoryValueMinor,
  evidence,
  excessiveDiscountImpact,
  floorMarginMinor,
  hasMinimumEvidence,
  impactPeriodLabel,
  isProductMature,
  lowMarginImpact,
  marginCompressionImpact,
  referencedRecordIds,
  supplierCostIncreaseImpact,
  suppressionReason,
} from './rules';

/**
 * Leak detectors.
 *
 * Each detector receives the full evidence set for a period pair and returns
 * either a `ProfitLeak` or a `SuppressedDetector` explaining why it stayed quiet.
 * Returning the suppression rather than `null` is deliberate: a merchant asking
 * "where is my margin going?" deserves to hear "only 3 sales in July, not enough to
 * conclude", not silence.
 *
 * All detectors are pure. They read the snapshots and aggregates gathered by the
 * application layer and never touch a repository, a clock or a logger.
 */

export interface DetectorContext {
  readonly businessId: ProfitLeak['businessId'];
  readonly currency: string;
  readonly current: FinancialSnapshot;
  readonly previous: FinancialSnapshot;
  readonly period: HalfOpenPeriod;
  readonly previousPeriod: HalfOpenPeriod;
  readonly expensesByCategory: ReadonlyMap<string, number>;
  readonly previousExpensesByCategory: ReadonlyMap<string, number>;
  readonly overdueReceivables: readonly OverdueReceivable[];
  readonly productSales: readonly ProductSaleAggregate[];
  readonly purchasePrices: ReadonlyMap<string, PurchasePriceAggregate>;
  readonly previousPurchasePrices: ReadonlyMap<string, PurchasePriceAggregate>;
  readonly products: readonly ProductAggregate[];
  /** Products with no sale in the trailing dead-stock window. */
  readonly productsWithRecentSales: ReadonlySet<string>;
  readonly detectedAt: Date;
}

export interface OverdueReceivable {
  readonly id: string;
  readonly customerId: string;
  readonly customerName: string;
  readonly openMinor: number;
  readonly daysOverdue: number;
}

export interface ProductSaleAggregate {
  readonly productId: string;
  readonly name: string;
  readonly quantity: number;
  readonly revenueMinor: number;
  readonly cogsMinor: number;
}

export interface PurchasePriceAggregate {
  readonly weightedUnitPriceMinor: number;
  readonly quantity: number;
}

export interface ProductAggregate {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly supplierId: string | null;
  readonly costPriceMinor: number;
  readonly sellingPriceMinor: number;
  readonly currentStock: number;
  readonly createdAt: Date;
}

export type DetectorResult =
  | { readonly fired: true; readonly leak: ProfitLeak }
  | { readonly fired: false; readonly suppressed: SuppressedDetector };

export interface Detector {
  readonly category: LeakCategory;
  readonly rule: string;
  detect(context: DetectorContext): DetectorResult;
}

// ---------------------------------------------------------------------------
// 1. Margin compression
// ---------------------------------------------------------------------------

/**
 * Gross margin fell by at least `MARGIN_COMPRESSION_BPS` against the comparison
 * period. Requires three pieces of evidence because the claim is about an
 * aggregate rather than a single record.
 */
export const marginCompressionDetector: Detector = {
  category: 'margin_compression',
  rule: 'gross margin dropped by >= 200 bps versus the previous equivalent period',
  detect(context) {
    const gate = suppressionReason({
      currentSampleSize: context.current.revenueRecognition.saleCount,
      baselineSampleSize: context.previous.revenueRecognition.saleCount,
      observed: context.current.grossMarginBps,
      baseline: context.previous.grossMarginBps,
      threshold: MARGIN_COMPRESSION_BPS,
      thresholdKind: 'fall_by_at_least',
    });
    if (gate) return suppress('margin_compression', gate, context);

    const impactMinor = clampImpact(
      marginCompressionImpact({
        currentRevenueMinor: context.current.revenue.amount,
        currentGrossProfitMinor: context.current.grossProfit.amount,
        baselineMarginBps: context.previous.grossMarginBps,
      }),
    );
    const entries = buildMarginEvidence(context);
    return toResult(marginCompressionDetector, context, entries, {
      rule: 'margin_compression',
      inputs: {
        currentGrossMarginBps: context.current.grossMarginBps,
        baselineGrossMarginBps: context.previous.grossMarginBps,
        currentRevenueMinor: context.current.revenue.amount,
        currentGrossProfitMinor: context.current.grossProfit.amount,
        currentCogsMinor: context.current.cogs.amount,
      },
      observedValue: context.current.grossMarginBps,
      baselineValue: context.previous.grossMarginBps,
      deviation: context.current.grossMarginBps - context.previous.grossMarginBps,
      deviationUnit: 'ratio_bps',
      impactMinor,
      title: 'Gross margin has fallen',
      description:
        `Gross margin moved from ${context.previous.grossMarginBps} bps to ` +
        `${context.current.grossMarginBps} bps, a fall of ` +
        `${Math.abs(context.current.grossMarginBps - context.previous.grossMarginBps)} bps.`,
      suggestedInvestigation:
        'Compare cost of goods against realised revenue per product to find which items lost margin.',
    });
  },
};

// ---------------------------------------------------------------------------
// 2. Supplier cost increase
// ---------------------------------------------------------------------------

/** Weighted purchase price rose by at least `SUPPLIER_COST_INCREASE_BPS`. */
export const supplierCostIncreaseDetector: Detector = {
  category: 'supplier_cost_increase',
  rule: 'weighted purchase unit price rose by >= 500 bps versus the previous equivalent period',
  detect(context) {
    const gate = suppressionReason({
      currentSampleSize: context.current.revenueRecognition.saleCount,
      baselineSampleSize: context.previous.revenueRecognition.saleCount,
      observed: 0,
      baseline: 0,
      threshold: 0,
      thresholdKind: 'at_least',
      baselineOptional: true,
    });
    if (gate) return suppress('supplier_cost_increase', gate, context);

    const candidates = findCostIncreases(context);
    if (candidates.length === 0) {
      return notFired(
        'supplier_cost_increase',
        'insufficient_history',
        'No product was purchased in both periods, so no purchase price can be compared.',
      );
    }

    const totalImpact = clampImpact(
      sumOf(candidates.map((candidate) => candidate.impactMinor)),
    );
    const entries = candidates.flatMap((candidate) => candidate.evidence);
    if (!hasMinimumEvidence(entries.length, 'supplier_cost_increase')) {
      return suppress(
        'supplier_cost_increase',
        {
          reason: 'insufficient_sample_size',
          explanation: `Only ${entries.length} purchase line(s) support the increase.`,
        },
        context,
      );
    }

    return toResult(supplierCostIncreaseDetector, context, entries, {
      rule: 'supplier_cost_increase',
      inputs: {
        productsAffected: candidates.length,
        impactMinor: totalImpact,
        ...sumInputs(candidates.map((c) => c.inputs)),
      },
      observedValue: candidates[0]?.currentPrice ?? 0,
      baselineValue: candidates[0]?.baselinePrice ?? 0,
      deviation: roundHalfAwayFromZero(
        (candidates[0]?.currentPrice ?? 0) - (candidates[0]?.baselinePrice ?? 0),
      ),
      deviationUnit: 'minor_units',
      impactMinor: totalImpact,
      title: 'Supplier purchase prices have increased',
      description:
        `${candidates.length} product(s) cost more to buy than in the previous equivalent period.`,
      suggestedInvestigation:
        'Compare current supplier pricing against selling prices to check the margin still holds.',
    });
  },
};

// ---------------------------------------------------------------------------
// 3. Excessive discounting
// ---------------------------------------------------------------------------

/**
 * Discount rate is at least `DISCOUNT_RATE_FLOOR_BPS` of gross revenue AND has
 * risen by at least `DISCOUNT_RATE_RISE_BPS` against the baseline.
 *
 * Both conditions are required. A merchant who always discounts heavily has a
 * pricing strategy, not a leak; one who has started discounting more heavily has
 * a leak.
 */
export const excessiveDiscountingDetector: Detector = {
  category: 'excessive_discounting',
  rule:
    'discounts exceed 10% of gross revenue and the discount rate rose by >= 500 bps versus baseline',
  detect(context) {
    const currentRate = context.current.revenueRecognition.discountRateBps;
    const baselineRate = context.previous.revenueRecognition.discountRateBps;
    const gate = suppressionReason({
      currentSampleSize: context.current.revenueRecognition.saleCount,
      baselineSampleSize: context.previous.revenueRecognition.saleCount,
      observed: currentRate ?? -1,
      baseline: baselineRate,
      threshold: DISCOUNT_RATE_FLOOR_BPS,
      thresholdKind: 'at_least',
    });
    if (gate) return suppress('excessive_discounting', gate, context);

    const rise = (currentRate ?? 0) - (baselineRate ?? 0);
    if (rise < DISCOUNT_RATE_RISE_BPS) {
      return notFired(
        'excessive_discounting',
        'threshold_not_met',
        `Discount rate rose by only ${rise} bps; ${DISCOUNT_RATE_RISE_BPS} bps is required once the ` +
          `${DISCOUNT_RATE_FLOOR_BPS / 100}% floor is met.`,
        { observed: currentRate, baseline: baselineRate, threshold: DISCOUNT_RATE_RISE_BPS },
      );
    }

    const impactMinor = clampImpact(
      excessiveDiscountImpact({
        currentGrossRevenueMinor: context.current.revenueRecognition.grossRevenue.amount,
        currentDiscountMinor: context.current.revenueRecognition.discounts.amount,
        baselineDiscountRateBps: baselineRate ?? 0,
      }),
    );

    const entries: LeakEvidence[] = [
      evidence({
        type: 'calculation',
        resourceId: 'discount-rate',
        description:
          `Discounts of ${context.current.revenueRecognition.discounts.amount} minor units on gross ` +
          `revenue of ${context.current.revenueRecognition.grossRevenue.amount}.`,
        value: currentRate,
      }),
      evidence({
        type: 'calculation',
        resourceId: 'discount-rate-baseline',
        description:
          `Baseline discount rate was ${baselineRate} bps on gross revenue of ` +
          `${context.previous.revenueRecognition.grossRevenue.amount}.`,
        value: baselineRate,
      }),
    ];

    return toResult(excessiveDiscountingDetector, context, entries, {
      rule: 'excessive_discounting',
      inputs: {
        currentDiscountMinor: context.current.revenueRecognition.discounts.amount,
        currentGrossRevenueMinor: context.current.revenueRecognition.grossRevenue.amount,
        currentDiscountRateBps: currentRate ?? 0,
        baselineDiscountRateBps: baselineRate ?? 0,
      },
      observedValue: currentRate ?? 0,
      baselineValue: baselineRate ?? 0,
      deviation: rise,
      deviationUnit: 'ratio_bps',
      impactMinor,
      title: 'Discounting has increased sharply',
      description:
        `Discounts now take ${((currentRate ?? 0) / 100).toFixed(2)}% of gross revenue, up from ` +
        `${((baselineRate ?? 0) / 100).toFixed(2)}%.`,
      suggestedInvestigation:
        'Check which products carry the largest discounts and whether the volume increase pays for them.',
    });
  },
};

// ---------------------------------------------------------------------------
// 4. Excessive expense anomalies
// ---------------------------------------------------------------------------

/** A category's spend rose by at least 1.5x baseline and by at least INR 2,000. */
export const abnormalExpensesDetector: Detector = {
  category: 'abnormal_expenses',
  rule:
    'a category total exceeds 1.5x its baseline AND rises by at least 200,000 minor units',
  detect(context) {
    const gate = suppressionReason({
      currentSampleSize: context.expensesByCategory.size,
      baselineSampleSize: context.previousExpensesByCategory.size,
      observed: 0,
      baseline: 0,
      threshold: 0,
      thresholdKind: 'at_least',
      baselineOptional: true,
    });
    if (gate) return suppress('abnormal_expenses', gate, context);

    const anomalies = [...context.expensesByCategory.entries()]
      .map(([category, currentMinor]) => ({ category, currentMinor, baselineMinor: context.previousExpensesByCategory.get(category) ?? 0 }))
      .filter((entry) => {
        if (entry.baselineMinor <= 0) return entry.currentMinor >= ABNORMAL_EXPENSE_MIN_INCREASE_MINOR;
        return (
          entry.currentMinor >= entry.baselineMinor * ABNORMAL_EXPENSE_MULTIPLIER &&
          entry.currentMinor - entry.baselineMinor >= ABNORMAL_EXPENSE_MIN_INCREASE_MINOR
        );
      })
      .sort((a, b) => b.currentMinor - a.currentMinor || a.category.localeCompare(b.category));

    if (anomalies.length === 0) {
      return notFired(
        'abnormal_expenses',
        'threshold_not_met',
        `No expense category exceeded ${ABNORMAL_EXPENSE_MULTIPLIER}x its baseline by more than ` +
          `${ABNORMAL_EXPENSE_MIN_INCREASE_MINOR} minor units.`,
      );
    }

    const totalImpact = clampImpact(
      sumOf(anomalies.map((entry) => abnormalExpenseImpact(entry))),
    );
    const entries = anomalies.flatMap((entry) => [
      evidence({
        type: 'expense',
        resourceId: `expense-category:${entry.category}`,
        description:
          `${entry.category}: ${entry.currentMinor} minor units this period against ` +
          `${entry.baselineMinor} previously.`,
        value: entry.currentMinor,
      }),
      evidence({
        type: 'calculation',
        resourceId: `expense-category-baseline:${entry.category}`,
        description: `${entry.category} baseline was ${entry.baselineMinor} minor units.`,
        value: entry.baselineMinor,
      }),
    ]);
    const settlement = evidence({
      type: 'calculation',
      resourceId: 'abnormal-expense-total',
      description: `${anomalies.length} expense categor(ies) exceeded the anomaly threshold.`,
      value: anomalies.length,
    });

    if (!hasMinimumEvidence(entries.length + 1, 'abnormal_expenses')) {
      return suppress(
        'abnormal_expenses',
        {
          reason: 'insufficient_sample_size',
          explanation: `Only ${entries.length} evidence item(s) support the anomaly.`,
        },
        context,
      );
    }

    return toResult(
      abnormalExpensesDetector,
      context,
      [...entries, settlement],
      {
        rule: 'abnormal_expenses',
        inputs: {
          categoriesAffected: anomalies.length,
          impactMinor: totalImpact,
          ...sumInputs(
            anomalies.map((entry) => ({ [`${entry.category}Current`]: entry.currentMinor })),
          ),
        },
        observedValue: anomalies[0]?.currentMinor ?? 0,
        baselineValue: anomalies[0]?.baselineMinor ?? 0,
        deviation: roundHalfAwayFromZero(
          (anomalies[0]?.currentMinor ?? 0) - (anomalies[0]?.baselineMinor ?? 0),
        ),
        deviationUnit: 'minor_units',
        impactMinor: totalImpact,
        title: 'Operating expenses rose sharply',
        description:
          `${anomalies.map((entry) => entry.category).join(', ')} spending rose well beyond its ` +
          'previous level.',
        suggestedInvestigation:
          'Check the individual expense records in these categories for one-off or duplicated charges.',
      },
    );
  },
};

// ---------------------------------------------------------------------------
// 5. Low-margin products
// ---------------------------------------------------------------------------

/** A sold product earns less than 5% gross margin. */
export const lowMarginProductsDetector: Detector = {
  category: 'low_margin_products',
  rule: 'a product with recorded sales earns < 500 bps gross margin',
  detect(context) {
    if (context.productSales.length === 0) {
      return notFired(
        'low_margin_products',
        'no_source_data',
        'No product-linked sale lines were recorded in this period.',
      );
    }

    const gate = suppressionReason({
      currentSampleSize: context.current.revenueRecognition.saleCount,
      baselineSampleSize: context.previous.revenueRecognition.saleCount,
      observed: 0,
      baseline: 0,
      threshold: 0,
      thresholdKind: 'at_least',
      baselineOptional: true,
    });
    if (gate) return suppress('low_margin_products', gate, context);

    const thin = context.productSales
      .filter((sale) => isProductMature({ createdAt: createdAtOf(context, sale.productId), asOf: context.detectedAt }))
      .map((sale) => {
        const marginBps = ratioBps(sale.revenueMinor - sale.cogsMinor, sale.revenueMinor) ?? 0;
        const product = context.products.find((candidate) => candidate.id === sale.productId);
        const floor = floorMarginMinor(product?.sellingPriceMinor ?? sale.revenueMinor, LOW_MARGIN_FLOOR_BPS);
        const unitMargin = sale.quantity > 0 ? Math.round((sale.revenueMinor - sale.cogsMinor) / sale.quantity) : 0;
        return {
          sale,
          product,
          marginBps,
          impactMinor: lowMarginImpact({
            unitMarginMinor: unitMargin,
            floorMarginMinor: floor,
            quantitySold: sale.quantity,
          }),
        };
      })
      .filter((entry) => entry.marginBps < LOW_MARGIN_FLOOR_BPS)
      .sort((a, b) => b.impactMinor - a.impactMinor);

    if (thin.length === 0) {
      return notFired(
        'low_margin_products',
        'threshold_not_met',
        `Every product with recorded sales earned at least ${LOW_MARGIN_FLOOR_BPS / 100}% gross margin.`,
      );
    }

    const totalImpact = clampImpact(sumOf(thin.map((entry) => entry.impactMinor)));
    const entries = thin.slice(0, 25).flatMap((entry) => [
      evidence({
        type: 'product',
        resourceId: entry.sale.productId,
        description: `${entry.sale.name}: ${entry.marginBps} bps gross margin on ${entry.sale.quantity} unit(s) sold.`,
        value: entry.marginBps,
      }),
      evidence({
        type: 'calculation',
        resourceId: `low-margin-shortfall:${entry.sale.productId}`,
        description: `Shortfall against the ${LOW_MARGIN_FLOOR_BPS / 100}% floor is ${entry.impactMinor} minor units.`,
        value: entry.impactMinor,
      }),
    ]);

    return toResult(lowMarginProductsDetector, context, entries, {
      rule: 'low_margin_products',
      inputs: {
        productsBelowFloor: thin.length,
        impactMinor: totalImpact,
        marginFloorBps: LOW_MARGIN_FLOOR_BPS,
      },
      observedValue: thin[0]?.marginBps ?? 0,
      baselineValue: LOW_MARGIN_FLOOR_BPS,
      deviation: (thin[0]?.marginBps ?? 0) - LOW_MARGIN_FLOOR_BPS,
      deviationUnit: 'ratio_bps',
      impactMinor: totalImpact,
      title: 'Products are selling below the margin floor',
      description: `${thin.length} product(s) with recorded sales earn less than ` +
        `${LOW_MARGIN_FLOOR_BPS / 100}% gross margin.`,
      suggestedInvestigation:
        'Review the cost price against the selling price for these products and consider repricing or delisting.',
    });
  },
};

// ---------------------------------------------------------------------------
// 6. Dead inventory
// ---------------------------------------------------------------------------

/** Active stock with no sale in `DEAD_INVENTORY_DAYS`, worth at least the minimum. */
export const deadInventoryDetector: Detector = {
  category: 'dead_inventory',
  rule: `active stock with no sale in ${DEAD_INVENTORY_DAYS} days and at-cost value >= 200,000 minor units`,
  detect(context) {
    if (context.products.length === 0) {
      return notFired('dead_inventory', 'no_source_data', 'The product master is empty.');
    }

    const candidates = context.products
      .filter((product) => product.status === 'active')
      .filter((product) => !context.productsWithRecentSales.has(product.id))
      .filter((product) => product.currentStock > 0)
      .filter((product) =>
        isProductMature({ createdAt: product.createdAt, asOf: context.detectedAt }),
      )
      .map((product) => ({
        product,
        valueMinor: deadInventoryValueMinor({
          currentStock: product.currentStock,
          costPriceMinor: product.costPriceMinor,
        }),
      }))
      .filter((entry) => entry.valueMinor >= DEAD_INVENTORY_MIN_VALUE_MINOR)
      .sort((a, b) => b.valueMinor - a.valueMinor);

    if (candidates.length === 0) {
      return notFired(
        'dead_inventory',
        'threshold_not_met',
        `No active product held unsold stock worth at least ${DEAD_INVENTORY_MIN_VALUE_MINOR} minor ` +
          `units for ${DEAD_INVENTORY_DAYS} days.`,
      );
    }

    const totalImpact = clampImpact(sumOf(candidates.map((entry) => entry.valueMinor)));
    const entries = candidates.slice(0, 25).map((entry) =>
      evidence({
        type: 'product',
        resourceId: entry.product.id,
        description:
          `${entry.product.name}: ${entry.product.currentStock} unit(s) unsold for ` +
          `${DEAD_INVENTORY_DAYS} days, valued at ${entry.valueMinor} minor units at cost.`,
        value: entry.valueMinor,
      }),
    );

    return toResult(deadInventoryDetector, context, entries, {
      rule: 'dead_inventory',
      inputs: {
        productsIdle: candidates.length,
        idleDays: DEAD_INVENTORY_DAYS,
        impactMinor: totalImpact,
      },
      observedValue: candidates[0]?.valueMinor ?? 0,
      baselineValue: DEAD_INVENTORY_MIN_VALUE_MINOR,
      deviation: (candidates[0]?.valueMinor ?? 0) - DEAD_INVENTORY_MIN_VALUE_MINOR,
      deviationUnit: 'minor_units',
      impactMinor: totalImpact,
      title: 'Stock is sitting unsold',
      description:
        `${candidates.length} product(s) have had no sale for ${DEAD_INVENTORY_DAYS} days while holding stock.`,
      suggestedInvestigation:
        'Consider discounting, bundling or returning this stock. Unsold inventory ties up cash at cost.',
    });
  },
};

// ---------------------------------------------------------------------------
// 7. Overdue receivables
// ---------------------------------------------------------------------------

/**
 * Open receivables past the business's own `overdue_threshold_days` setting
 * (default 30 days). The merchant's configured threshold is used rather than a
 * hardcoded one, so a merchant who expects 60-day terms is not alarmed.
 */
export const overdueReceivablesDetector: Detector = {
  category: 'overdue_receivables',
  rule: 'open receivables exceed the business overdue threshold in days',
  detect(context) {
    if (context.overdueReceivables.length === 0) {
      return notFired(
        'overdue_receivables',
        'no_source_data',
        'No open receivable is past its due date.',
      );
    }

    const totalImpact = clampImpact(
      sumOf(context.overdueReceivables.map((receivable) => receivable.openMinor)),
    );
    const worst = [...context.overdueReceivables].sort(
      (a, b) => b.openMinor - a.openMinor,
    )[0];
    if (worst === undefined) {
      return notFired('overdue_receivables', 'no_source_data', 'No receivable is overdue.');
    }

    const entries = context.overdueReceivables.slice(0, 25).map((receivable) =>
      evidence({
        type: 'customer',
        resourceId: receivable.id,
        description:
          `${receivable.customerName}: ${receivable.openMinor} minor units outstanding, ` +
          `${receivable.daysOverdue} day(s) past due.`,
        value: receivable.openMinor,
      }),
    );

    return toResult(overdueReceivablesDetector, context, entries, {
      rule: 'overdue_receivables',
      inputs: {
        overdueReceivables: context.overdueReceivables.length,
        impactMinor: totalImpact,
        oldestDaysOverdue: worst.daysOverdue,
      },
      observedValue: totalImpact,
      baselineValue: 0,
      deviation: totalImpact,
      deviationUnit: 'minor_units',
      impactMinor: totalImpact,
      title: 'Customer payments are overdue',
      description:
        `${context.overdueReceivables.length} customer balance(s) totalling ${totalImpact} minor units ` +
        `are past due, the oldest by ${worst.daysOverdue} days.`,
      suggestedInvestigation:
        'Review these balances and prepare payment reminders for the affected customers.',
    });
  },
};

// ---------------------------------------------------------------------------
// 8. Payment fees — structurally unavailable
// ---------------------------------------------------------------------------

/**
 * The schema records `payment_method` but no fee, charge or settlement amount.
 * There is therefore no quantity to measure and any figure would be invented.
 *
 * Reported as `UnavailableDetector` so the gap is visible to the product owner
 * rather than presenting as a clean result. The remedy is a schema change owned
 * by the database-security agent, not a clever query.
 */
export const highPaymentFeesDetector: Detector = {
  category: 'high_payment_fees',
  rule: 'unavailable: no fee or charge data is stored',
  detect() {
    return notFired(
      'high_payment_fees',
      'unavailable_metric',
      'Payment fees cannot be measured: the schema stores a payment method but no fee amount.',
    );
  },
};

export const highPaymentFeesUnavailable: UnavailableDetector = {
  category: 'high_payment_fees',
  reason:
    'No payment fee, charge or settlement column exists. `transactions.payment_method` records how a ' +
    'customer paid, not what it cost.',
  requiredData: [
    'transactions.payment_fee_minor (fee charged for the payment method used)',
    'A reconciliation source tying the fee to the transaction it belongs to',
  ],
};

/** Every detector, in a stable order so a report is reproducible. */
export const DETECTORS: readonly Detector[] = [
  marginCompressionDetector,
  supplierCostIncreaseDetector,
  excessiveDiscountingDetector,
  abnormalExpensesDetector,
  lowMarginProductsDetector,
  deadInventoryDetector,
  overdueReceivablesDetector,
  highPaymentFeesDetector,
];

export const UNAVAILABLE_DETECTORS: readonly UnavailableDetector[] = [highPaymentFeesUnavailable];

// ---------------------------------------------------------------------------
// Shared assembly
// ---------------------------------------------------------------------------

interface LeakDraft {
  readonly rule: LeakCategory;
  readonly inputs: Readonly<Record<string, number>>;
  readonly observedValue: number;
  readonly baselineValue: number;
  readonly deviation: number;
  readonly deviationUnit: 'minor_units' | 'ratio_bps' | 'quantity';
  readonly impactMinor: number;
  readonly title: string;
  readonly description: string;
  readonly suggestedInvestigation: string;
}

function toResult(
  detector: Detector,
  context: DetectorContext,
  entries: readonly LeakEvidence[],
  draft: LeakDraft,
): DetectorResult {
  if (!hasMinimumEvidence(entries.length, detector.category)) {
    return suppress(
      detector.category,
      {
        reason: 'insufficient_sample_size',
        explanation: `Only ${entries.length} evidence item(s) are available; this rule needs more.`,
      },
      context,
    );
  }

  const calculation: LeakCalculation = {
    rule: draft.rule,
    ruleDescription: detector.rule,
    formula: FORMULAS[draft.rule],
    inputs: draft.inputs,
    observedValue: draft.observedValue,
    baselineValue: draft.baselineValue,
    deviation: draft.deviation,
    deviationUnit: draft.deviationUnit,
    periodStart: context.period.from,
    periodEnd: context.period.to,
    comparisonPeriodStart: context.previousPeriod.from,
    comparisonPeriodEnd: context.previousPeriod.to,
    currency: context.currency,
  };

  const leak: ProfitLeak = {
    id: leakId(context, detector.category, draft.impactMinor),
    businessId: context.businessId,
    category: detector.category,
    severity: classifySeverity(draft.impactMinor),
    title: draft.title,
    description: draft.description,
    impact: { amount: draft.impactMinor, currency: context.currency as ProfitLeak['impact']['currency'] },
    impactPeriod: impactPeriodLabel(context.period.from, context.period.to),
    evidence: entries,
    status: 'active',
    detectedAt: context.detectedAt,
    currency: context.currency,
    calculation,
    suggestedInvestigation: draft.suggestedInvestigation,
    relatedRecordIds: referencedRecordIds(entries),
  };

  return { fired: true, leak };
}

/**
 * Human-readable formula per rule, surfaced in the "why am I seeing this?" panel
 * so the arithmetic is inspectable without reading the code.
 */
/**
 * The arithmetic behind each rule, keyed by the rule's stable category id.
 *
 * Keyed by category rather than by prose so a reworded rule string cannot silently
 * orphan its formula; `tests/intelligence/profit-leaks.test.ts` asserts every
 * detector has an entry here.
 */
export const FORMULAS: Readonly<Record<LeakCategory, string>> = {
  margin_compression:
    'impact = round(currentRevenue * baselineGrossMarginBps / 10000) - currentGrossProfit',
  supplier_cost_increase:
    'impact = sum over affected products of round((currentWeightedUnitPrice - baselineWeightedUnitPrice) * quantitySold)',
  excessive_discounting:
    'impact = currentDiscount - round(currentGrossRevenue * baselineDiscountRateBps / 10000)',
  abnormal_expenses:
    'impact = sum over affected categories of max(0, currentCategoryTotal - baselineCategoryTotal)',
  low_margin_products:
    'impact = sum over products of round((floorMarginPerUnit - unitMargin) * quantitySold)',
  dead_inventory: 'impact = sum over idle products of round(costPrice * currentStock)',
  overdue_receivables:
    'impact = sum of open balances (amount - paid) for receivables past the business overdue threshold',
  high_payment_fees: 'not computable with the current schema',
};

function suppress(
  category: LeakCategory,
  gate: { reason: SuppressionReason; explanation: string },
  context: DetectorContext,
): DetectorResult {
  return {
    fired: false,
    suppressed: {
      category,
      reason: gate.reason,
      explanation: gate.explanation,
      observed: context.current.revenue.amount,
      baseline: context.previous.revenue.amount,
      threshold: MIN_SAMPLE_SIZE,
      sampleSize: context.current.revenueRecognition.saleCount,
    },
  };
}

function notFired(
  category: LeakCategory,
  reason: SuppressionReason,
  explanation: string,
  numbers?: { observed?: number; baseline?: number; threshold?: number },
): DetectorResult {
  return {
    fired: false,
    suppressed: {
      category,
      reason,
      explanation,
      ...(numbers?.observed === undefined ? {} : { observed: numbers.observed }),
      ...(numbers?.baseline === undefined ? {} : { baseline: numbers.baseline }),
      ...(numbers?.threshold === undefined ? {} : { threshold: numbers.threshold }),
    },
  };
}

interface CostIncreaseCandidate {
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
function findCostIncreases(context: DetectorContext): CostIncreaseCandidate[] {
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

function buildMarginEvidence(context: DetectorContext): LeakEvidence[] {
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

function createdAtOf(context: DetectorContext, productId: string): Date {
  return (
    context.products.find((product) => product.id === productId)?.createdAt ??
    new Date(context.detectedAt.getTime() - PRODUCT_MIN_AGE_DAYS_MS)
  );
}

const PRODUCT_MIN_AGE_DAYS_MS = PRODUCT_MIN_AGE_DAYS * 86_400_000;

/**
 * Stable id for a leak.
 *
 * Derived from tenant, category, period and impact so re-running detection over
 * the same period produces the same id, which keeps persisted leaks
 * de-duplicable instead of accumulating a new row on every run.
 */
export function leakId(
  context: DetectorContext,
  category: LeakCategory,
  impactMinor: number,
): string {
  return [
    context.businessId,
    category,
    context.period.from.toISOString(),
    context.period.to.toISOString(),
    String(impactMinor),
  ].join(':');
}

function sumOf(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function sumInputs(entries: readonly Readonly<Record<string, number>>[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

export { weightedAverageMinorUnits, MIN_SAMPLE_SIZE };