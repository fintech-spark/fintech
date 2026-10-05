import 'server-only';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import type { TenantDatabaseClient } from '@/lib/database/client';
import type { DatabaseTransaction } from '@/lib/database/client';
import type { DateRange, TenantContext } from '@/lib/types';
import type { InternalActionCapabilities } from '../application/production-executors';
import { APPROVAL_TTL_MS, hashActionParameters } from '../domain/rules';
import type { Action } from '../domain/types';

/** Validate/stage internal mutations. The repository commits effects with terminal state and audit. */
export function createPostgresInternalActionCapabilities(
  db: TenantDatabaseClient,
  getSnapshot: (ctx: TenantContext, period: DateRange) => Promise<Readonly<Record<string, unknown>>>,
): InternalActionCapabilities {
  async function assertClaimed(action: Action, ctx: TenantContext, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (db.businessId !== ctx.businessId || action.businessId !== ctx.businessId || ctx.role !== 'owner') {
      throw new AuthorizationError('Action capability requires the business owner.');
    }
    const rows = await db.query<{ id: string }>(CLAIMED_SQL, [ctx.businessId, action.id, hashActionParameters(action), action.type, APPROVAL_TTL_MS, ctx.userId]);
    if (rows.length !== 1) throw new ConflictError('Action has no live execution claim.');
    signal?.throwIfAborted();
  }
  return {
    generateReport: async (action, ctx, period, signal) => {
      await assertClaimed(action, ctx, signal);
      if (period.to.getTime() - period.from.getTime() > 366 * 86_400_000) throw new ValidationError('Report period may not exceed 366 days.');
      const snapshot = await getSnapshot(ctx, period);
      signal?.throwIfAborted();
      return snapshot;
    },
    adjustPrice: async (action, ctx, productId, price, signal) => {
      await assertClaimed(action, ctx, signal);
      const rows = await db.query<{ id: string }>(ADJUST_PRICE_SQL, [ctx.businessId, productId, price, action.id, hashActionParameters(action)]);
      if (rows[0] === undefined) throw new NotFoundError('Active product', productId);
      return rows[0].id;
    },
    changeSupplier: async (action, ctx, productId, supplierId, signal) => {
      await assertClaimed(action, ctx, signal);
      const rows = await db.query<{ id: string }>(CHANGE_SUPPLIER_SQL, [ctx.businessId, productId, supplierId, action.id, hashActionParameters(action)]);
      if (rows[0] === undefined) throw new NotFoundError('Active product or supplier', productId);
      return rows[0].id;
    },
  };
}

const CLAIMED_SQL = `SELECT id FROM actions WHERE business_id = $1 AND id = $2
  AND status = 'executing' AND detail->>'parametersHash' = $3 AND type = $4
  AND detail ? 'executionKey' AND approved_at <= now()
  AND approved_at >= now() - ($5 * interval '1 millisecond')
  AND EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = $1
    AND m.user_id = $6 AND m.role = 'owner' AND m.status = 'active' LIMIT 1)
  LIMIT 1`;

const ADJUST_PRICE_SQL = `SELECT p.id FROM products p
  WHERE p.business_id = $1 AND p.id = $2 AND p.status = 'active'
  AND EXISTS (SELECT 1 FROM actions a WHERE a.business_id = $1 AND a.id = $4
    AND a.status = 'executing' AND a.type = 'adjust_price' AND a.detail->>'parametersHash' = $5
    AND a.parameters->>'productId' = $2::text AND (a.parameters->>'newPriceMinor')::bigint = $3 LIMIT 1)
   `;

const CHANGE_SUPPLIER_SQL = `SELECT p.id FROM products p
  WHERE p.business_id = $1 AND p.id = $2 AND p.status = 'active'
  AND EXISTS (SELECT 1 FROM suppliers s WHERE s.business_id = $1 AND s.id = $3 AND s.status = 'active' LIMIT 1)
  AND EXISTS (SELECT 1 FROM actions a WHERE a.business_id = $1 AND a.id = $4
    AND a.status = 'executing' AND a.type = 'change_supplier' AND a.detail->>'parametersHash' = $5
    AND a.parameters->>'productId' = $2::text AND a.parameters->>'supplierId' = $3::text LIMIT 1)
   `;

/** Effects run on the SAME connection/transaction as terminal state and immutable audit. */
export async function applyInternalActionEffect(tx: Pick<DatabaseTransaction, 'query'>, action: Action, actorId: string): Promise<void> {
  if (!action.result?.success || !action.result.executorId?.startsWith('internal:')) return;
  if (action.type !== 'adjust_price' && action.type !== 'change_supplier') return;
  const params = action.parameters;
  const rows = await tx.query<{ id: string }>(action.type === 'adjust_price'
    ? `UPDATE products p SET selling_price_minor = $3, updated_at = now()
       WHERE p.business_id = $1 AND p.id = $2 AND p.status = 'active'
       AND EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = $1 AND m.user_id = $4 AND m.role = 'owner' AND m.status = 'active') RETURNING p.id`
    : `UPDATE products p SET supplier_id = $3, updated_at = now()
       WHERE p.business_id = $1 AND p.id = $2 AND p.status = 'active'
       AND EXISTS (SELECT 1 FROM suppliers s WHERE s.business_id = $1 AND s.id = $3 AND s.status = 'active')
       AND EXISTS (SELECT 1 FROM business_members m WHERE m.business_id = $1 AND m.user_id = $4 AND m.role = 'owner' AND m.status = 'active') RETURNING p.id`,
    [action.businessId, params.productId, action.type === 'adjust_price' ? params.newPriceMinor : params.supplierId, actorId]);
  if (rows.length !== 1) throw new NotFoundError('Active action target', String(params.productId));
}
