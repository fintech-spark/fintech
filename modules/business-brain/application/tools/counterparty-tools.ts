// Merchant Brain: customer and supplier context tools
//
// PII MINIMISATION IS ENFORCED HERE, NOT BY CONVENTION
// ---------------------------------------------------
// `customers` and `suppliers` store phone, email, address and GSTIN. Those four
// column families are absent from every statement in `counterparty-facts.ts` and
// from every schema below, so a phone number has no path into a prompt. Names,
// balances and activity remain: they are what makes the answer possible.
//
// Minimum role is `manager` for both, because each output carries a counterparty
// balance. An AI tool that can enumerate who owes the merchant is not a
// `staff` capability.

import { z } from 'zod';
import { defineTool } from '@/lib/ai/tools/registry';
import { currencySchema, minorUnitsSchema } from '@/lib/ai/tools/schemas';
import type { DatabaseClient } from '@/lib/database/client';
import {
  loadCustomerActivity,
  loadPayablesSummary,
  loadReceivablesSummary,
  loadSupplierActivity,
  loadSupplierPricing,
} from '../../infrastructure/counterparty-facts';
import {
  DEFAULT_WINDOW_DAYS,
  metric,
  periodFields,
  periodOutputShape,
  toDateRange,
  TOOL_SCHEMAS,
  trailingPeriod,
} from './common';

// ---------------------------------------------------------------------------
// customer_context
// ---------------------------------------------------------------------------

export function createCustomerContextTool(database: DatabaseClient) {
  return defineTool({
    name: 'customer_context',
    version: 'v1',
    description:
      'Customer activity for a date window: per-customer purchase count and value, lifetime purchase total, outstanding balance and last transaction date, plus total receivables and how much is overdue. Optionally focuses on one customer id. Contact details (phone, email, address, GSTIN) are deliberately NOT returned. Use this for "who stopped buying" and for receivables questions.',
    inputSchema: z
      .object({
        period: TOOL_SCHEMAS.period.optional(),
        customerId: z.string().uuid().optional(),
        limit: TOOL_SCHEMAS.narrowLimit.optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        ...periodOutputShape,
        customers: z.array(
          z
            .object({
              customerId: z.string().min(1),
              name: z.string().min(1),
              status: z.string().min(1),
              purchaseCount: z.number().int().nonnegative(),
              periodPurchaseMinor: minorUnitsSchema,
              lifetimePurchaseMinor: minorUnitsSchema,
              outstandingBalanceMinor: minorUnitsSchema,
              lastTransactionDate: z.string().nullable(),
            })
            .strict(),
        ),
        receivables: z.array(
          z
            .object({
              currency: currencySchema,
              outstandingMinor: minorUnitsSchema,
              overdueMinor: minorUnitsSchema,
              overdueCount: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        metrics: z.array(z.unknown()),
        truncated: z.boolean(),
      })
      .strict(),
    authorization: { minimumRole: 'manager', permission: 'customers:read' },
    sensitivity: 'customer_pii',
    readOnly: true,
    source: 'analytics',
    async execute(ctx, input) {
      const period = input.period ? toDateRange(input.period) : trailingPeriod(DEFAULT_WINDOW_DAYS);
      const limit = input.limit ?? 25;

      const [rows, receivables] = await Promise.all([
        loadCustomerActivity(database, ctx.tenant.businessId, {
          from: period.from,
          to: period.to,
          ...(input.customerId ? { customerId: input.customerId } : {}),
          limit,
        }),
        loadReceivablesSummary(database, ctx.tenant.businessId),
      ]);

      const customers = rows.map((row) => ({
        customerId: row.id,
        name: row.name,
        status: row.status,
        purchaseCount: row.purchase_count,
        periodPurchaseMinor: row.recent_purchase_minor,
        lifetimePurchaseMinor: row.total_purchases_minor,
        outstandingBalanceMinor: row.outstanding_balance_minor,
        lastTransactionDate: row.last_transaction_date
          ? new Date(row.last_transaction_date).toISOString()
          : null,
      }));

      const metrics = receivables.flatMap((row) => [
        metric({
          name: 'receivables_outstanding',
          value: row.outstandingMinor,
          period,
          source: 'analytics',
        }),
        metric({
          name: 'receivables_overdue',
          value: row.overdueMinor,
          period,
          source: 'analytics',
        }),
      ]);

      return {
        ...periodFields(period),
        customers,
        receivables: receivables.map((row) => ({
          currency: row.currency,
          outstandingMinor: row.outstandingMinor,
          overdueMinor: row.overdueMinor,
          overdueCount: row.overdueCount,
        })),
        metrics,
        truncated: rows.length === limit,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// supplier_context
// ---------------------------------------------------------------------------

export function createSupplierContextTool(database: DatabaseClient) {
  return defineTool({
    name: 'supplier_context',
    version: 'v1',
    description:
      'Supplier context for a date window: per-supplier purchase count and value, lifetime purchases, outstanding payable, last transaction date, current list prices for that supplier\'s products, and total payables with the overdue portion. Optionally focuses on one supplier id. Contact details are deliberately NOT returned. NOTE: this schema stores only the CURRENT supplier price — no price history table exists, so do not describe these as a trend. Use this for cost-increase explanations.',
    inputSchema: z
      .object({
        period: TOOL_SCHEMAS.period.optional(),
        supplierId: z.string().uuid().optional(),
        limit: TOOL_SCHEMAS.narrowLimit.optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        ...periodOutputShape,
        suppliers: z.array(
          z
            .object({
              supplierId: z.string().min(1),
              name: z.string().min(1),
              status: z.string().min(1),
              purchaseCount: z.number().int().nonnegative(),
              periodPurchaseMinor: minorUnitsSchema,
              lifetimePurchaseMinor: minorUnitsSchema,
              outstandingPayableMinor: minorUnitsSchema,
              lastTransactionDate: z.string().nullable(),
            })
            .strict(),
        ),
        currentPrices: z.array(
          z
            .object({
              supplierName: z.string().min(1),
              productName: z.string().min(1),
              unitPriceMinor: minorUnitsSchema,
              currency: currencySchema,
              lastUpdated: z.string().min(1),
            })
            .strict(),
        ),
        payables: z.array(
          z
            .object({
              currency: currencySchema,
              outstandingMinor: minorUnitsSchema,
              overdueMinor: minorUnitsSchema,
              overdueCount: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        priceHistoryAvailable: z.literal(false),
        truncated: z.boolean(),
      })
      .strict(),
    authorization: { minimumRole: 'manager', permission: 'suppliers:read' },
    sensitivity: 'supplier_commercial',
    readOnly: true,
    source: 'analytics',
    async execute(ctx, input) {
      const period = input.period ? toDateRange(input.period) : trailingPeriod(DEFAULT_WINDOW_DAYS);
      const limit = input.limit ?? 25;
      const supplierId = input.supplierId;

      const [rows, prices, payables] = await Promise.all([
        loadSupplierActivity(database, ctx.tenant.businessId, {
          from: period.from,
          to: period.to,
          ...(supplierId ? { supplierId } : {}),
          limit,
        }),
        loadSupplierPricing(database, ctx.tenant.businessId, {
          ...(supplierId ? { supplierId } : {}),
          limit,
        }),
        loadPayablesSummary(database, ctx.tenant.businessId),
      ]);

      return {
        ...periodFields(period),
        suppliers: rows.map((row) => ({
          supplierId: row.id,
          name: row.name,
          status: row.status,
          purchaseCount: row.purchase_count,
          periodPurchaseMinor: row.recent_purchase_minor,
          lifetimePurchaseMinor: row.total_purchases_minor,
          outstandingPayableMinor: row.outstanding_payable_minor,
          lastTransactionDate: row.last_transaction_date
            ? new Date(row.last_transaction_date).toISOString()
            : null,
        })),
        currentPrices: prices.map((row) => ({
          supplierName: row.supplierName,
          productName: row.productName,
          unitPriceMinor: row.unitPriceMinor,
          currency: row.currency,
          lastUpdated: row.lastUpdated,
        })),
        payables: payables.map((row) => ({
          currency: row.currency,
          outstandingMinor: row.outstandingMinor,
          overdueMinor: row.overdueMinor,
          overdueCount: row.overdueCount,
        })),
        priceHistoryAvailable: false as const,
        truncated: rows.length === limit,
      };
    },
  });
}
