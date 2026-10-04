import { withApi } from "@/lib/http/handler";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { wireIntelligence } from "@/lib/http/wiring";

/**
 * POST /api/businesses/[businessId]/actions/[id]/execute
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'actions:execute');
  const { actions } = wireIntelligence(ctx.businessId);
  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  const outcome = await actions.execute(ctx, {
    id: route.params.id,
    idempotencyKey,
  });
  return { status: 200, data: outcome };
});
