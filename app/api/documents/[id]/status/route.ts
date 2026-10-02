import { withApi } from '@/lib/http/handler';
import { parseUuid, parseJsonBody } from '@/lib/http/params';
import { updateDocumentStatusSchema } from '@/lib/validation/api-schemas';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * PATCH /api/documents/:id/status — Phase 1 DOCUMENT_STATUS_TRANSITIONS; illegal moves are 422.
 */
export const PATCH = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db as never);
  const id = parseUuid(route.params.id, 'id') as never;
  const body = await parseJsonBody(request, updateDocumentStatusSchema);
  return { data: await services.documents.updateStatus(ctx, id, body.status, body.reason) };
});
