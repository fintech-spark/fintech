import { withApi } from '@/lib/http/handler';
import { parsePagination, parseEnum, parseSearch } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/inventory/products — tenant-scoped, paginated.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db);
  const sp = new URL(request.url).searchParams;
  const pagination = parsePagination(sp);

  const result = await services.inventory.listProducts(ctx, {
    page: pagination.page,
    limit: pagination.limit,
    status: parseEnum(sp.get('status'), ['active','discontinued','out_of_stock'] as const, 'status'),
    category: parseSearch(sp.get('category'), 80),
    search: parseSearch(sp.get('search')),
  });

  return { data: result.items, meta: { total: result.total, page: result.page, limit: result.limit, hasMore: result.hasMore } };
});
