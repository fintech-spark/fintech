import { withApi } from '@/lib/http/handler';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/suppliers/payables/totals
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'suppliers:read');
  const services = wireClient(db);
  return { data: await services.suppliers.getTotalPayables(ctx) };
});
