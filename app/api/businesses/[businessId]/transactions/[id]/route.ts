import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { NotFoundError } from '@/lib/errors';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/transactions/:id — 404 for a record owned by another tenant.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { transactions } = wireClient(db);
  const id = parseUuid(route.params.id, 'id') as never;
  const found = await transactions.getById(ctx, id);
  if (!found) throw new NotFoundError('Transaction', route.params.id);
  return { data: found };
});
