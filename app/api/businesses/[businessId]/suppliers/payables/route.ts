import { withApi } from '@/lib/http/handler';
import { parsePagination, parseEnum, parseUuid } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/suppliers/payables — tenant-scoped payable ledger.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db);
  const sp = new URL(request.url).searchParams;
  const pagination = parsePagination(sp);

  const result = await services.suppliers.getPayables(ctx, {
    page: pagination.page,
    limit: pagination.limit,
    supplierId: sp.get('supplierId') ? (parseUuid(sp.get('supplierId'), 'supplierId') as never) : undefined,
    status: parseEnum(sp.get('status'), ['pending','partial','paid','overdue'] as const, 'status'),
  });

  return { data: result.items, meta: { total: result.total, page: result.page, limit: result.limit, hasMore: result.hasMore } };
});
