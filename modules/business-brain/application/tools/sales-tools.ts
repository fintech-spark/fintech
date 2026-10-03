// Merchant Brain: sales, product and transaction tools
//
// Every figure here is aggregated in Postgres over integer minor units and any
// ratio is computed by a deterministic rule in `modules/analytics`. The model
// receives finished numbers with a named window and a currency; it is never
// asked to sum, divide, or compare.

import { z } from 'zod';
import { defineTool } from '@/lib/ai/tools/registry';
import { currencySchema, minorUnitsSchema } from '@/lib/ai/tools/schemas';
import type { DatabaseClient } from '@/lib/database/client';
import { calculateChangeBps } from '@/modules/analytics';
import {
  loadProductPerformance,
  loadSalesTotals,
  searchTransactions,
} from '../../infrastructure/sales-facts';
import {
  DEFAULT_WINDOW_DAYS,
  metric,
  periodFields,
  periodOutputShape,
  previousPeriod,
  profitAndMargin,
  toDateRange,
  TOOL_SCHEMAS,
  trailingPeriod,
} from './common';
import type { PeriodSalesTotals } from '../../infrastructure/sales-facts';

// ---------------------------------------------------------------------------
// sales_summary
// ---------------------------------------------------------------------------

const currencyBlockSchema = z
  .object({
    currency: currencySchema,
    revenueMinor: minorUnitsSchema,
    refundMinor: minorUnitsSchema,
    /** Deterministic: revenue - refunds. */
    netRevenueMinor: minorUnitsSchema,
    discountMinor: minorUnitsSchema,
    taxMinor: minorUnitsSchema,
    transactionCount: z.number().int().nonnegative(),
    /** Deterministic: revenue / count, rounded. Zero when there were no sales. */
    averageOrderValueMinor: minorUnitsSchema,
  })
  .strict();

const salesSummaryOutput = z
  .object({
    ...periodOutputShape,
    byCurrency: z.array(currencyBlockSchema),
    comparison: z
      .object({
        periodStart: z.string(),
        periodEnd: z.string(),
        byCurrency: z.array(currencyBlockSchema),
      })
      .strict(),
    metrics: z.array(z.unknown()),
    /** True when the comparison window had no sales at all. */
    comparisonAvailable: z.boolean(),
  })
  .strict();

export function createSalesSummaryTool(database: DatabaseClient) {
  return defineTool({
    name: 'sales_summary',
    version: 'v1',
    description:
      'Deterministic sales totals for a date window: revenue, refunds, net revenue, discounts, tax, transaction count and average order value, plus the immediately preceding window of equal length for comparison. All amounts are integer minor units (paise for INR). Voided and draft transactions are excluded. Answers "how are sales doing" and "did sales drop" — use product_performance for the per-product breakdown and customer_context for who stopped buying.',
    inputSchema: z
      .object({ period: TOOL_SCHEMAS.period.optional() })
      .strict(),
    outputSchema: salesSummaryOutput,
    authorization: { minimumRole: 'staff', permission: 'analytics:read' },
    sensitivity: 'financial',
    readOnly: true,
    source: 'analytics',
    async execute(ctx, input) {
      const period = input.period ? toDateRange(input.period) : trailingPeriod(DEFAULT_WINDOW_DAYS);
      const comparison = previousPeriod(period);

      const [current, prior] = await Promise.all([
        loadSalesTotals(database, ctx.tenant.businessId, period.from, period.to),
        loadSalesTotals(database, ctx.tenant.businessId, comparison.from, comparison.to),
      ]);

      const byCurrency = current.map((row) => toCurrencyBlock(row));
      const comparisonByCurrency = prior.map((row) => toCurrencyBlock(row));

      const metrics = byCurrency.flatMap((row) => [
        metric({
          name: 'revenue',
          value: row.revenueMinor,
          period,
          source: 'analytics',
          previousValue: findPrior(comparisonByCurrency, row.currency)?.revenueMinor ?? 0,
        }),
        metric({
          name: 'net_revenue',
          value: row.netRevenueMinor,
          period,
          source: 'analytics',
          previousValue: findPrior(comparisonByCurrency, row.currency)?.netRevenueMinor ?? 0,
        }),
        metric({
          name: 'refunds',
          value: row.refundMinor,
          period,
          source: 'analytics',
        }),
        metric({
          name: 'average_order_value',
          value: row.averageOrderValueMinor,
          period,
          source: 'analytics',
        }),
        {
          metric: 'transaction_count',
          value: row.transactionCount,
          unit: 'count' as const,
          currency: row.currency,
          changeBps: calculateChangeBps(
            row.transactionCount,
            findPrior(comparisonByCurrency, row.currency)?.transactionCount ?? 0,
          ),
        },
      ]);

      return {
        ...periodFields(period),
        byCurrency,
        comparison: {
          periodStart: comparison.from.toISOString(),
          periodEnd: comparison.to.toISOString(),
          byCurrency: comparisonByCurrency,
        },
        metrics,
        comparisonAvailable: prior.length > 0,
      };
    },
  });
}

function toCurrencyBlock(row: PeriodSalesTotals) {
  return {
    currency: row.currency,
    revenueMinor: row.revenueMinor,
    refundMinor: row.refundMinor,
    netRevenueMinor: row.revenueMinor - row.refundMinor,
    discountMinor: row.discountMinor,
    taxMinor: row.taxMinor,
    transactionCount: row.transactionCount,
    averageOrderValueMinor:
      row.transactionCount > 0
        ? Math.round(row.revenueMinor / row.transactionCount)
        : 0,
  };
}

function findPrior(
  comparison: readonly { currency: string; revenueMinor: number; netRevenueMinor: number; transactionCount: number }[],
  currency: string,
) {
  return comparison.find((row) => row.currency === currency);
}

// ---------------------------------------------------------------------------
// product_performance
// ---------------------------------------------------------------------------

const productRowSchema = z
  .object({
    productId: z.string().min(1),
    productName: z.string().min(1),
    category: z.string().nullable(),
    unitsSold: z.number().nonnegative(),
    revenueMinor: minorUnitsSchema,
    costMinor: minorUnitsSchema,
    grossProfitMinor: minorUnitsSchema,
    grossMarginBps: z.number().int(),
    currency: currencySchema,
  })
  .strict();

export function createProductPerformanceTool(database: DatabaseClient) {
  return defineTool({
    name: 'product_performance',
    version: 'v1',
    description:
      'Per-product units sold, revenue, cost of goods, gross profit and gross margin for a date window, ranked by revenue. Cost of goods is priced at products.cost_price_minor, not the price charged. Margin is in basis points (4000 = 40%). Use this for "which product is dragging us down" and to localise a revenue fall.',
    inputSchema: z
      .object({
        period: TOOL_SCHEMAS.period,
        categories: z.array(TOOL_SCHEMAS.term.describe('product category')).max(10).optional(),
        limit: TOOL_SCHEMAS.narrowLimit.optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        ...periodOutputShape,
        products: z.array(productRowSchema),
        truncated: z.boolean(),
      })
      .strict(),
    authorization: { minimumRole: 'staff', permission: 'analytics:read' },
    sensitivity: 'financial',
    readOnly: true,
    source: 'analytics',
    async execute(ctx, input) {
      const period = input.period ? toDateRange(input.period) : trailingPeriod(DEFAULT_WINDOW_DAYS);
      const limit = input.limit ?? 20;

      const rows = await loadProductPerformance(database, ctx.tenant.businessId, {
        from: period.from,
        to: period.to,
        ...(input.categories ? { categories: input.categories } : {}),
        limit,
      });

      return {
        ...periodFields(period),
        products: rows.map((row) => {
          const profit = profitAndMargin(row.revenueMinor, row.costMinor, row.currency);
          return {
            productId: row.productId,
            productName: row.productName,
            category: row.category,
            unitsSold: row.unitsSold,
            revenueMinor: row.revenueMinor,
            costMinor: row.costMinor,
            grossProfitMinor: profit.grossProfitMinor,
            grossMarginBps: profit.grossMarginBps,
            currency: row.currency,
          };
        }),
        truncated: rows.length === limit,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// transaction_search
// ---------------------------------------------------------------------------

export function createTransactionSearchTool(database: DatabaseClient) {
  return defineTool({
    name: 'transaction_search',
    version: 'v1',
    description:
      'Bounded structured lookup of settled sale, purchase, payment and refund transactions in a date window. Optionally filters by type, counterparty id, or a minimum total. Returns at most the requested limit, newest first. Free-text notes are NOT searchable and there is no free-form filter — use sales_summary or customer_context for aggregates.',
    inputSchema: z
      .object({
        period: TOOL_SCHEMAS.period,
        type: z.enum(['sale', 'purchase', 'payment', 'refund']).optional(),
        counterpartyId: z.string().uuid().optional(),
        minTotalMinor: minorUnitsSchema.optional(),
        limit: TOOL_SCHEMAS.limit.optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        ...periodOutputShape,
        transactions: z.array(
          z
            .object({
              id: z.string().min(1),
              type: z.string().min(1),
              status: z.string().min(1),
              counterpartyType: z.string().min(1),
              counterpartyId: z.string(),
              totalMinor: minorUnitsSchema,
              currency: currencySchema,
              transactionDate: z.string().min(1),
              reference: z.string().nullable(),
            })
            .strict(),
        ),
        truncated: z.boolean(),
      })
      .strict(),
    authorization: { minimumRole: 'staff', permission: 'transactions:read' },
    sensitivity: 'financial',
    readOnly: true,
    source: 'database',
    async execute(ctx, input) {
      const period = input.period ? toDateRange(input.period) : trailingPeriod(DEFAULT_WINDOW_DAYS);
      const limit = input.limit ?? 20;

      const rows = await searchTransactions(database, ctx.tenant.businessId, {
        from: period.from,
        to: period.to,
        ...(input.type ? { type: input.type } : {}),
        ...(input.counterpartyId ? { counterpartyId: input.counterpartyId } : {}),
        ...(input.minTotalMinor !== undefined ? { minTotalMinor: input.minTotalMinor } : {}),
        limit,
      });

      return {
        ...periodFields(period),
        transactions: rows.map((row) => ({
          id: row.id,
          type: row.type,
          status: row.status,
          counterpartyType: row.counterpartyType,
          counterpartyId: row.counterpartyId,
          totalMinor: row.totalMinor,
          currency: row.currency,
          transactionDate: row.transactionDate,
          reference: row.reference,
        })),
        truncated: rows.length === limit,
      };
    },
  });
}

