import { withApi } from '@/lib/http/handler';
import { parsePagination, parseEnum, parseSearch } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/suppliers — read-only.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db as never);
  const sp = new URL(request.url).searchParams;
  const pagination = parsePagination(sp);

  const result = await services.suppliers.list(ctx, {
    page: pagination.page,
    limit: pagination.limit,
    status: parseEnum(sp.get('status'), ['active','inactive'] as const, 'status'),
    search: parseSearch(sp.get('search')),
  });

  return { data: result.items, meta: { total: result.total, page: result.page, limit: result.limit, hasMore: result.hasMore } };
});
