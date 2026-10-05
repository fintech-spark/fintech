import { withApi } from '@/lib/http/handler';
import { parseUuid, parseJsonBody } from '@/lib/http/params';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { assertTrustedOrigin } from '@/lib/auth/http';
import { documentReviewSchema } from '@/modules/documents/domain/review';
import { promoteReviewedDocument } from '@/modules/documents/application/promotion';
import { asDocumentId } from '@/lib/types';

/**
 * POST /api/documents/:id/approve
 */
export const POST = withApi(async (request: Request, route) => {
  assertTrustedOrigin(request);
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'documents:write');
  const review = await parseJsonBody(request, documentReviewSchema);
  return { data: await promoteReviewedDocument(db, ctx, asDocumentId(parseUuid(route.params.id, 'id')), review) };
});
