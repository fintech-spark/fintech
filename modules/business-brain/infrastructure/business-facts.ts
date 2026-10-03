// Merchant Brain: business profile facts
//
// Read-only, tenant-scoped. Every statement binds `business_id = $1` from the
// authenticated `TenantContext` via `tenantQuery`, which refuses any SQL that
// does not.

import 'server-only';

import type { BusinessId, CurrencyCode } from '@/lib/types';
import type { DatabaseClient } from '@/lib/database/client';
import { tenantQuery } from './tenant-query';

export interface BusinessOverviewFacts {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly type: string;
  readonly status: string;
  readonly industry: string | null;
  readonly currency: CurrencyCode;
  readonly timezone: string;
  readonly fiscalYearStart: number;
  readonly lowStockThreshold: number;
  readonly overdueThresholdDays: number;
}

interface BusinessRow {
  readonly id: string;
  readonly name: string;
  readonly display_name: string | null;
  readonly type: string;
  readonly status: string;
  readonly industry: string | null;
  readonly currency: string;
  readonly timezone: string;
  readonly fiscal_year_start: number;
  readonly low_stock_threshold: number;
  readonly overdue_threshold_days: number;
}

const OVERVIEW_SQL = `
SELECT
  id, name, display_name, type, status, industry,
  currency, timezone, fiscal_year_start,
  low_stock_threshold, overdue_threshold_days
FROM businesses
WHERE id = $1
LIMIT 1
`.trim();

/**
 * The tenant's own business row.
 *
 * `businesses` has no `business_id` column — its primary key IS the tenant id,
 * and its RLS policy reads `id IN (auth_user_businesses())`. Scoping by
 * `id = $1` is therefore equivalent to the ordinary predicate, which is why the
 * query declares the `root_id` scope explicitly rather than skipping the guard.
 */
export async function loadBusinessOverview(
  database: DatabaseClient,
  businessId: BusinessId,
): Promise<BusinessOverviewFacts | null> {
  const rows = await tenantQuery<BusinessRow>(database, businessId, OVERVIEW_SQL, [], 'root_id');
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    type: row.type,
    status: row.status,
    industry: row.industry,
    currency: row.currency as CurrencyCode,
    timezone: row.timezone,
    fiscalYearStart: row.fiscal_year_start,
    lowStockThreshold: row.low_stock_threshold,
    overdueThresholdDays: row.overdue_threshold_days,
  };
}
