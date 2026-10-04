import { withApi } from '@/lib/http/handler';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/inventory/value — deterministic valuation in domain/rules, never by a model.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'inventory:read');
  const services = wireClient(db);
  return { data: await services.inventory.getInventoryValue(ctx) };
});
