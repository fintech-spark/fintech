import { withApi } from '@/lib/http/handler';
import { parseJsonBody } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { duplicateCheckSchema } from '@/lib/validation/api-schemas';

/**
 * POST /api/transactions/duplicate-check — read-only heuristic from Phase 1 `isDuplicateCandidate`.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { transactions } = wireClient(db as never);
  const body = await parseJsonBody(request, duplicateCheckSchema);
  const match = await transactions.checkDuplicate(ctx, {
    type: body.type,
    counterpartyType: body.counterpartyType,
    counterpartyId: body.counterpartyId,
    items: [{ productId: '00000000-0000-4000-8000-000000000000', quantity: 1, unitPrice: body.total }],
    transactionDate: new Date(body.transactionDate),
  });
  return { data: { duplicate: match !== null, match } };
});
