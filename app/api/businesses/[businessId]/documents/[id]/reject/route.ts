import { withApi } from '@/lib/http/handler';
import { parseUuid, parseJsonBody } from '@/lib/http/params';
import { rejectDocumentSchema } from '@/lib/validation/api-schemas';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * POST /api/documents/:id/reject — a reason is mandatory.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'documents:write');
  const services = wireClient(db);
  const body = await parseJsonBody(request, rejectDocumentSchema);
  return { data: await services.documents.reject(ctx, parseUuid(route.params.id, 'id') as never, body.reason) };
});
