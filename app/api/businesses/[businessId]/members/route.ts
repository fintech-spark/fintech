import { withApi } from '@/lib/http/handler';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/businesses/:businessId/members — memberships of the current business.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { businesses } = wireClient(db);
  return { data: await businesses.getMembers(ctx) };
});
