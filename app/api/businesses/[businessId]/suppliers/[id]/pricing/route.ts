import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/suppliers/:id/pricing — supplier-specific product pricing.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'suppliers:read');
  const services = wireClient(db);
  return { data: await services.suppliers.getPricing(ctx, parseUuid(route.params.id, 'id') as never) };
});
