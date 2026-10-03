// Merchant Brain: business overview tool
//
// The cheapest question a merchant can ask ("what business am I looking at?")
// and the one most likely to be asked first, so it takes no period and no
// filters. It returns only non-sensitive profile fields — never GSTIN, PAN,
// address, phone or email.

import { z } from 'zod';
import { defineTool } from '@/lib/ai/tools/registry';
import { currencySchema } from '@/lib/ai/tools/schemas';
import type { DatabaseClient } from '@/lib/database/client';
import { loadBusinessOverview } from '../../infrastructure/business-facts';

const outputSchema = z
  .object({
    name: z.string().min(1),
    displayName: z.string().nullable(),
    type: z.string().min(1),
    status: z.string().min(1),
    industry: z.string().nullable(),
    currency: currencySchema,
    timezone: z.string().min(1),
    fiscalYearStart: z.number().int().min(1).max(12),
    lowStockThreshold: z.number().int().nonnegative(),
    overdueThresholdDays: z.number().int().nonnegative(),
  })
  .strict();

export function createBusinessOverviewTool(database: DatabaseClient) {
  return defineTool({
    name: 'business_overview',
    version: 'v1',
    description:
      'Trusted profile of the merchant\'s own business: name, type, status, currency, timezone and fiscal settings. Use this to ground currency and calendar questions. Contains no financial figures.',
    inputSchema: z.object({}).strict(),
    outputSchema,
    authorization: { minimumRole: 'staff', permission: 'settings:read' },
    sensitivity: 'business_profile',
    readOnly: true,
    source: 'database',
    async execute(ctx) {
      const overview = await loadBusinessOverview(database, ctx.tenant.businessId);
      if (!overview) {
        // Absent business row is an environment fault, not a business fact the
        // model should be asked to reason about.
        throw new Error('business profile not found for the authenticated tenant');
      }

      return {
        name: overview.name,
        displayName: overview.displayName,
        type: overview.type,
        status: overview.status,
        industry: overview.industry,
        currency: overview.currency,
        timezone: overview.timezone,
        fiscalYearStart: overview.fiscalYearStart,
        lowStockThreshold: overview.lowStockThreshold,
        overdueThresholdDays: overview.overdueThresholdDays,
      };
    },
  });
}
