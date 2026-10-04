import { withApi } from '@/lib/http/handler';
import { parseJsonBody, parsePagination, parseEnum, parseSearch } from '@/lib/http/params';
import { createDocumentSchema } from '@/lib/validation/api-schemas';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * POST /api/documents — registers metadata for an already-stored object.

The binary is written by a separate upload step; this records the pointer.
The schema rejects absolute paths, traversal segments, backslashes and empty
segments. It cannot check the tenant prefix — it has no tenant to compare
against — so `DefaultDocumentService.upload` enforces that the leading path
segment is the authenticated business id.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'documents:write');
  const services = wireClient(db);
  const body = await parseJsonBody(request, createDocumentSchema);
  return {
    status: 201,
    data: await services.documents.upload(ctx, {
      fileName: body.fileName,
      mimeType: body.mimeType,
      fileSize: body.fileSize,
      sourceType: body.sourceType,
      storagePath: body.storagePath,
      tags: body.tags,
    }),
  };
});

/**
 * GET /api/documents
 *
 * Metadata listing. Private storage objects are never proxied through this
 * route; a client must go through an authorised download path.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'documents:read');
  const services = wireClient(db);
  const sp = new URL(request.url).searchParams;
  const pagination = parsePagination(sp);

  const result = await services.documents.list(ctx, {
    page: pagination.page,
    limit: pagination.limit,
    status: parseEnum(sp.get('status'), ['uploaded','validating','queued','processing','extracted','review_required','approved','rejected','failed'] as const, 'status'),
    sourceType: parseEnum(sp.get('sourceType'), ['invoice','receipt','upi_screenshot','pdf','audio','csv','excel','whatsapp_export','text','image','other'] as const, 'sourceType'),
    search: parseSearch(sp.get('search')),
  });

  return {
    data: result.items,
    meta: { total: result.total, page: result.page, limit: result.limit, hasMore: result.hasMore },
  };
});
