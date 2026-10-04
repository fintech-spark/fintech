import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { NotFoundError } from '@/lib/errors';

/**
 * GET /api/customers/:id — 404 across tenants.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'customers:read');
  const services = wireClient(db);
  const found = await services.customers.getById(ctx, parseUuid(route.params.id, 'id') as never);
  if (!found) throw new NotFoundError('Customer', route.params.id);
  return { data: found };
});
