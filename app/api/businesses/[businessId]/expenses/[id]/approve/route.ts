import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * POST /api/expenses/:id/approve — pending only; anything else is 422.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'expenses:write');
  const { expenses } = wireClient(db);
  const id = parseUuid(route.params.id, 'id') as never;
  return { data: await expenses.approve(ctx, id) };
});
