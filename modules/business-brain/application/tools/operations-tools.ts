// Merchant Brain: inventory and expense tools
//
// Reorder and valuation decisions come from `modules/inventory/domain/rules.ts`
// and the aggregates come from Postgres over integer minor units. The model is
// told what is low, what it is worth, and which categories moved — never asked
// to work it out.

import { z } from 'zod';
import { defineTool } from '@/lib/ai/tools/registry';
import { currencySchema, minorUnitsSchema } from '@/lib/ai/tools/schemas';
import type { DatabaseClient } from '@/lib/database/client';
import {
  loadExpenseByCategory,
  loadRecurringExpenses,
} from '../../infrastructure/expense-facts';
import {
  loadInventoryMovements,
  loadInventorySnapshot,
} from '../../infrastructure/inventory-facts';
import {
  DEFAULT_WINDOW_DAYS,
  metric,
  periodFields,
  periodOutputShape,
  previousPeriod,
  toDateRange,
  TOOL_SCHEMAS,
  trailingPeriod,
} from './common';

// ---------------------------------------------------------------------------
// inventory_status
// ---------------------------------------------------------------------------

export function createInventoryStatusTool(database: DatabaseClient) {
  return defineTool({
    name: 'inventory_status',
    version: 'v1',
    description:
      'Current stock position: product count, count of items at or below their reorder point, total inventory value at cost price, and the low-stock items themselves with their reorder quantities. Also returns recent stock movements in a window. Use this for "are we about to run out" and for stockout explanations in a sales fall.',
    inputSchema: z
      .object({
        period: TOOL_SCHEMAS.period.optional(),
        categories: z.array(TOOL_SCHEMAS.term.describe('product category')).max(10).optional(),
        limit: TOOL_SCHEMAS.narrowLimit.optional(),
      })
      .strict(),
    outputSchema: z
      .object({
        ...periodOutputShape,
        productCount: z.number().int().nonnegative(),
        lowStockCount: z.number().int().nonnegative(),
        inventoryValueMinor: minorUnitsSchema,
        currency: currencySchema,
        lowStock: z.array(
          z
            .object({
              productId: z.string().min(1),
              name: z.string().min(1),
              sku: z.string().nullable(),
              currentStock: z.number().nonnegative(),
              reorderPoint: z.number().nonnegative(),
              reorderQuantity: z.number().nonnegative(),
              unit: z.string().min(1),
            })
            .strict(),
        ),
        movements: z.array(
          z
            .object({
              id: z.string().min(1),
              productName: z.string().min(1),
              type: z.string().min(1),
              quantity: z.number().positive(),
              previousStock: z.number().nonnegative(),
              newStock: z.number().nonnegative(),
              createdAt: z.string().min(1),
            })
            .strict(),
        ),
        truncated: z.boolean(),
      })
      .strict(),
    authorization: { minimumRole: 'staff', permission: 'inventory:read' },
    sensitivity: 'financial',
    readOnly: true,
    source: 'domain_service',
    async execute(ctx, input) {
      const period = input.period ? toDateRange(input.period) : trailingPeriod(DEFAULT_WINDOW_DAYS);
      const limit = input.limit ?? 25;

      const snapshot = await loadInventorySnapshot(database, ctx.tenant.businessId, {
        ...(input.categories ? { categories: input.categories } : {}),
        limit,
      });
      const movements = await loadInventoryMovements(database, ctx.tenant.businessId, {
        from: period.from,
        to: period.to,
        limit,
      });

      return {
        ...periodFields(period),
        productCount: snapshot.productCount,
        lowStockCount: snapshot.lowStockCount,
        inventoryValueMinor: snapshot.inventoryValueMinor,
        currency: snapshot.currency,
        lowStock: snapshot.lowStock.map((item) => ({
          productId: item.productId,
          name: item.name,
          sku: item.sku,
          currentStock: item.currentStock,
          reorderPoint: item.reorderPoint,
          reorderQuantity: item.reorderQuantity,
          unit: item.unit,
        })),
        movements: movements.map((movement) => ({
          id: movement.id,
          productName: movement.product_name,
          type: movement.type,
          quantity: movement.quantity,
          previousStock: movement.previous_stock,
          newStock: movement.new_stock,
          createdAt:
            movement.created_at instanceof Date
              ? movement.created_at.toISOString()
              : new Date(movement.created_at).toISOString(),
        })),
        truncated: snapshot.truncated,
      };
    },
  });
}

// ---------------------------------------------------------------------------
// expense_summary
// ---------------------------------------------------------------------------

export function createExpenseSummaryTool(database: DatabaseClient) {
  return defineTool({
    name: 'expense_summary',
    version: 'v1',
    description:
      'Approved and paid expenses grouped by category for a date window, with the immediately preceding window of equal length for comparison, plus upcoming recurring commitments. Pending and rejected expenses are excluded. Use this for "where is the money going" and to separate cost pressure from a revenue fall.',
    inputSchema: z.object({ period: TOOL_SCHEMAS.period.optional() }).strict(),
    outputSchema: z
      .object({
        ...periodOutputShape,
        byCategory: z.array(
          z
            .object({
              category: z.string().min(1),
              currency: currencySchema,
              totalMinor: minorUnitsSchema,
              entryCount: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        comparison: z
          .object({
            periodStart: z.string().min(1),
            periodEnd: z.string().min(1),
            byCategory: z.array(
              z
                .object({
                  category: z.string().min(1),
                  currency: currencySchema,
                  totalMinor: minorUnitsSchema,
                  entryCount: z.number().int().nonnegative(),
                })
                .strict(),
            ),
          })
          .strict(),
        recurring: z.array(
          z
            .object({
              category: z.string().min(1),
              description: z.string().min(1),
              amountMinor: minorUnitsSchema,
              currency: currencySchema,
              frequency: z.string().min(1),
              nextDueDate: z.string().min(1),
            })
            .strict(),
        ),
        metrics: z.array(z.unknown()),
        comparisonAvailable: z.boolean(),
      })
      .strict(),
    authorization: { minimumRole: 'staff', permission: 'expenses:read' },
    sensitivity: 'financial',
    readOnly: true,
    source: 'analytics',
    async execute(ctx, input) {
      const period = input.period ? toDateRange(input.period) : trailingPeriod(DEFAULT_WINDOW_DAYS);
      const comparison = previousPeriod(period);

      const [current, prior, recurring] = await Promise.all([
        loadExpenseByCategory(database, ctx.tenant.businessId, period.from, period.to),
        loadExpenseByCategory(database, ctx.tenant.businessId, comparison.from, comparison.to),
        loadRecurringExpenses(database, ctx.tenant.businessId, 20),
      ]);

      const byCategory = current.map((row) => ({
        category: row.category,
        currency: row.currency,
        totalMinor: row.totalMinor,
        entryCount: row.entryCount,
      }));

      const metrics = byCategory.map((row) => {
        const previousRow = prior.find(
          (candidate) => candidate.category === row.category && candidate.currency === row.currency,
        );
        return metric({
          name: `expense_${row.category}`,
          value: row.totalMinor,
          period,
          source: 'analytics',
          previousValue: previousRow?.totalMinor ?? 0,
        });
      });

      return {
        ...periodFields(period),
        byCategory,
        comparison: {
          periodStart: comparison.from.toISOString(),
          periodEnd: comparison.to.toISOString(),
          byCategory: prior.map((row) => ({
            category: row.category,
            currency: row.currency,
            totalMinor: row.totalMinor,
            entryCount: row.entryCount,
          })),
        },
        recurring: recurring.map((row) => ({
          category: row.category,
          description: row.description,
          amountMinor: row.amountMinor,
          currency: row.currency,
          frequency: row.frequency,
          nextDueDate: row.nextDueDate,
        })),
        metrics,
        comparisonAvailable: prior.length > 0,
      };
    },
  });
}
