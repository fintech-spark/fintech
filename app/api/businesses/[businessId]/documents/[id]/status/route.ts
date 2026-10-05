import { withApi } from '@/lib/http/handler';
import { parseUuid, parseJsonBody } from '@/lib/http/params';
import { updateDocumentStatusSchema } from '@/lib/validation/api-schemas';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { assertTrustedOrigin } from '@/lib/auth/http';
import { wireProductionDocuments } from '@/lib/http/documents';
import { BusinessRuleError } from '@/lib/errors';

/**
 * PATCH /api/documents/:id/status — Phase 1 DOCUMENT_STATUS_TRANSITIONS; illegal moves are 422.
 */
export const PATCH = withApi(async (request: Request, route) => {
  assertTrustedOrigin(request);
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'documents:write');
  const services = wireClient(db);
  const id = parseUuid(route.params.id, 'id') as never;
  const body = await parseJsonBody(request, updateDocumentStatusSchema);
  if (body.status === 'queued') {
    return { data: await wireProductionDocuments(db).documents.process(ctx, id) };
  }
  if (body.status !== 'rejected') throw new BusinessRuleError('Processing states are server-managed. Use review approval or queue a failed document for retry.');
  return { data: await services.documents.updateStatus(ctx, id, body.status, body.reason) };
});
export const maxDuration = 120;
