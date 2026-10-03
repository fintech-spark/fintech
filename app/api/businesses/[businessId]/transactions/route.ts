import { withApi } from '@/lib/http/handler';
import { parseJsonBody, parsePagination, parseEnum, parseUuid, dateRangeArgs } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { createTransactionSchema } from '@/lib/validation/api-schemas';

/**
 * POST /api/transactions — creates a draft. Totals are computed in the service, never by the caller.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { transactions } = wireClient(db);
  const body = await parseJsonBody(request, createTransactionSchema);
  const created = await transactions.create(ctx, {
    ...body,
    transactionDate: new Date(body.transactionDate),
    items: body.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
      tax: i.tax,
    })),
  });
  return { data: created, status: 201 };
});

/**
 * GET /api/transactions — one page of the tenant's transactions.
 *
 * Every filter is validated at the boundary and every value reaches PostgREST as
 * a bound value, never as SQL text. `counterpartyId` is optional; when absent the
 * list is not narrowed by counterparty.
 */
export const GET = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { transactions } = wireClient(db);
  const sp = new URL(request.url).searchParams;
  const pagination = parsePagination(sp);

  const counterpartyId = sp.get('counterpartyId');
  const type = parseEnum(sp.get('type'), ['sale', 'purchase', 'payment', 'refund'] as const, 'type');
  const status = parseEnum(
    sp.get('status'),
    ['draft', 'confirmed', 'completed', 'voided'] as const,
    'status',
  );

  const result = await transactions.list(ctx, {
    page: pagination.page,
    limit: pagination.limit,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(counterpartyId ? { counterpartyId: parseUuid(counterpartyId, 'counterpartyId') } : {}),
    ...dateRangeArgs(sp),
  });

  return {
    data: result.items,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    },
  };
});
