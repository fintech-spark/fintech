import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { NotFoundError } from '@/lib/errors';

/**
 * GET /api/suppliers/:id — 404 across tenants.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db as never);
  const found = await services.suppliers.getById(ctx, parseUuid(route.params.id, 'id') as never);
  if (!found) throw new NotFoundError('Supplier', route.params.id);
  return { data: found };
});
