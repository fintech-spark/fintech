import { withApi } from '@/lib/http/handler';
import { parseJsonBody, parseUuid } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { updateTransactionStatusSchema } from '@/lib/validation/api-schemas';

/**
 * PATCH /api/transactions/:id/status — Phase 1 transition table; illegal moves are 422.
 */
export const PATCH = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { transactions } = wireClient(db);
  const id = parseUuid(route.params.id, 'id') as never;
  const body = await parseJsonBody(request, updateTransactionStatusSchema);
  return { data: await transactions.updateStatus(ctx, id, body.status) };
});
