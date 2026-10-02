import { withApi } from '@/lib/http/handler';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/customers/receivables/totals — outstanding and overdue sums.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db as never);
  return { data: await services.customers.getTotalReceivables(ctx) };
});
