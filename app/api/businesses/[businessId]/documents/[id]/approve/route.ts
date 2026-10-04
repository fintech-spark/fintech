import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * POST /api/documents/:id/approve
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'documents:write');
  const services = wireClient(db);
  return { data: await services.documents.approve(ctx, parseUuid(route.params.id, 'id') as never) };
});
