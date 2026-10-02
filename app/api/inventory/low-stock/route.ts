import { withApi } from '@/lib/http/handler';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/inventory/low-stock — Phase 1 `needsReorder` rule applied server-side.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db as never);
  return { data: await services.inventory.getLowStockProducts(ctx) };
});
