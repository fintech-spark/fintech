import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/suppliers/:id/pricing — supplier-specific product pricing.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db as never);
  return { data: await services.suppliers.getPricing(ctx, parseUuid(route.params.id, 'id') as never) };
});
