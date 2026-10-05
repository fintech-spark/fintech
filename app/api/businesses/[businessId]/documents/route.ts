import { withApi } from '@/lib/http/handler';
import { parsePagination, parseEnum, parseSearch } from '@/lib/http/params';
import { assertTrustedOrigin } from '@/lib/auth/http';
import { parseDocumentUpload } from '@/modules/documents/application/multipart';
import { wireProductionDocuments } from '@/lib/http/documents';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/** Multipart bytes -> private storage -> verified metadata -> reviewable candidate. */
export const POST = withApi(async (request: Request, route) => {
  assertTrustedOrigin(request);
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'documents:write');
  const body = await parseDocumentUpload(request);
  const services = wireProductionDocuments(db);
  return {
    status: 201,
    data: await services.documents.uploadBytes(ctx, body),
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
export const maxDuration = 120;
