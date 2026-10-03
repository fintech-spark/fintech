// Merchant Brain: tenant-scoped query guard
//
// WHY THIS EXISTS
// ---------------
// `DATABASE_URL` connects as a role with `rolbypassrls = true`, so every RLS
// policy in migration 20261002000004 is INERT for this connection. Application
// code is the only thing standing between a merchant's question and another
// merchant's ledger.
//
// `lib/database/postgres-client.ts` documents that `forTenant()` "does NOT
// automatically inject tenant filters — that is the repository's
// responsibility", and migration 20261002000007 refers to a code-side guard
// (`assertTenantSafe`) that was never written. This module is that guard.
//
// It is a structural control, not a review checklist: a query whose text lacks
// a `business_id = $n` predicate cannot be executed through this helper. That
// turns "did you remember to scope this?" from a code-review question into a
// runtime refusal.

import 'server-only';

import type { BusinessId } from '@/lib/types';
import { DatabaseError } from '@/lib/errors';
import type { DatabaseClient } from '@/lib/database/client';

/**
 * Matches a tenant predicate bound to any parameter position.
 *
 * `$1` is the conventional position and `tenantQuery` always binds the tenant
 * there, but the pattern tolerates other positions so a caller writing a
 * `EXISTS` subquery is not forced into a contrived layout.
 */
const TENANT_PREDICATE = /business_id\s*=\s*\$\d+/i;

/**
 * Matches a predicate against a table whose primary key *is* the tenant id.
 *
 * Only `businesses` and `users` qualify: their RLS policies read
 * `id IN (auth_user_businesses())` because they have no `business_id` column.
 * Scoping them by `id = $1` is equivalent, not weaker.
 */
const ROOT_ID_PREDICATE = /\bid\s*=\s*\$\d+/i;

/**
 * How a statement expresses tenant scope.
 *
 * - `business_id` — the ordinary case; the table carries a `business_id`
 *   column and the predicate must reference it.
 * - `root_id`     — reserved for root tables (`businesses`, `users`) where the
 *   primary key is the tenant identifier. Opting in is explicit so the weaker
 *   pattern can never be reached by accident.
 */
export type TenantScope = 'business_id' | 'root_id';

export class MissingTenantPredicateError extends DatabaseError {
  constructor(sql: string, scope: TenantScope) {
    super('Refusing to execute a query with no tenant predicate.', {
      reason: 'missing_tenant_predicate',
      expectedScope: scope,
      sql: collapse(sql),
    });
  }
}

/**
 * Fails closed unless the statement scopes itself to a tenant.
 *
 * `FROM documents` alone is rejected. So is a query that only mentions
 * `business_id` in a SELECT list, because the pattern requires the equality
 * form.
 */
export function assertTenantPredicate(sql: string, scope: TenantScope = 'business_id'): void {
  const satisfied =
    scope === 'root_id'
      ? TENANT_PREDICATE.test(sql) || ROOT_ID_PREDICATE.test(sql)
      : TENANT_PREDICATE.test(sql);

  if (!satisfied) throw new MissingTenantPredicateError(sql, scope);
}

/**
 * Runs a tenant-scoped read.
 *
 * `businessId` is passed separately from `sql` precisely so it cannot be
 * confused with caller-supplied values: it is always bound as `$1`, before any
 * caller parameter.
 */
export async function tenantQuery<T = unknown>(
  database: DatabaseClient,
  businessId: BusinessId,
  sql: string,
  params: readonly unknown[] = [],
  scope: TenantScope = 'business_id',
): Promise<readonly T[]> {
  assertTenantPredicate(sql, scope);
  return database.query<T>(sql, [businessId, ...params]);
}

/** Strips whitespace so a rejected statement is readable in a log. */
function collapse(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().slice(0, 240);
}
