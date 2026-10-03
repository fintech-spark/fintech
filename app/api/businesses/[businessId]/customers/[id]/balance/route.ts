import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/customers/:id/balance
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db);
  return { data: await services.customers.getBalance(ctx, parseUuid(route.params.id, 'id') as never) };
});
