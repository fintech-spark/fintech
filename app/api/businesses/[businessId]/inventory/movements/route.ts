import { withApi } from '@/lib/http/handler';
import { recordMovementSchema } from '@/lib/validation/api-schemas';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { parseJsonBody } from '@/lib/http/params';
import { wireClient } from '@/lib/http/wiring';

/**
 * POST /api/inventory/movements — compare-and-set on stock.

Concurrency: the repository re-asserts the observed stock in its WHERE clause,
so a lost update fails rather than overwriting. Negative resulting stock is a
422 business-rule violation, not a silent clamp.
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const services = wireClient(db);
  const body = await parseJsonBody(request, recordMovementSchema);

  const result = await services.inventory.recordMovement(ctx, {
    productId: body.productId as never,
    type: body.type,
    quantity: body.quantity,
    reference: body.reference,
    referenceType: body.referenceType,
    referenceId: body.referenceId,
  });

  return {
    // A replay of an already-recorded reference created nothing, so it is not
    // a 201. Reporting it as one would tell the caller a movement exists when
    // the response is the ORIGINAL movement, not a new one.
    status: result.replayed ? 200 : 201,
    data: result.movement,
  };
});
