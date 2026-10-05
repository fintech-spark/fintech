import { withApi } from '@/lib/http/handler';
import { parseUuid } from '@/lib/http/params';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { NotFoundError } from '@/lib/errors';
import { asDocumentId } from '@/lib/types';
import { PostgrestExtractionRepository } from '@/modules/extraction';
import { PrivateDocumentStorage } from '@/modules/documents/infrastructure/private-storage';
import type { Document } from '@/modules/documents';
import type { ExtractionResult } from '@/modules/extraction';

/**
 * GET /api/documents/:id — 404 across tenants.
 */
export const GET = withApi<(Document & { extraction: ExtractionResult | null }) | { sourceUrl: string }>(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'documents:read');
  const services = wireClient(db);
  const found = await services.documents.getById(ctx, parseUuid(route.params.id, 'id') as never);
  if (!found) throw new NotFoundError('Document', route.params.id);
  if (new URL(request.url).searchParams.get('source') === '1') {
    return { data: { sourceUrl: await new PrivateDocumentStorage(db).signedSource(ctx.businessId, found.storagePath) } };
  }
  const extraction = await new PostgrestExtractionRepository(db).findByDocument(ctx.businessId, asDocumentId(found.id));
  return { data: { ...found, extraction } };
});
