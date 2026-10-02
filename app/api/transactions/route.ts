import { withApi } from '@/lib/http/handler';
import { parseJsonBody } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { createTransactionSchema } from '@/lib/validation/api-schemas';

/**
 * POST /api/transactions — creates a draft. Totals are computed in the service, never by the caller.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { transactions } = wireClient(db as never);
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
  return { data: created };
});
