import { withApi } from '@/lib/http/handler';
import { parsePagination, parseEnum, parseUuid, dateRangeArgs } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';

/**
 * GET /api/customers/receivables — tenant-scoped receivable ledger.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db);
  const sp = new URL(request.url).searchParams;
  const pagination = parsePagination(sp);

  const result = await services.customers.getReceivables(ctx, {
    page: pagination.page,
    limit: pagination.limit,
    customerId: sp.get('customerId') ? (parseUuid(sp.get('customerId'), 'customerId') as never) : undefined,
    status: parseEnum(sp.get('status'), ['pending','partial','paid','overdue','written_off'] as const, 'status'),
    ...dateRangeArgs(sp),
  });

  return { data: result.items, meta: { total: result.total, page: result.page, limit: result.limit, hasMore: result.hasMore } };
});
