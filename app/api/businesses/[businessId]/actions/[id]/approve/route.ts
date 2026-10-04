import { withApi } from "@/lib/http/handler";
import { assertPermission, resolveTenantContext } from "@/lib/http/auth-context";
import { wireIntelligence } from "@/lib/http/wiring";
import { asActionId } from "@/lib/types";

/**
 * POST /api/businesses/[businessId]/actions/[id]/approve
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  assertPermission(ctx, 'actions:approve');
  const { actions } = wireIntelligence(ctx.businessId);
  const action = await actions.approve(ctx, asActionId(route.params.id));
  return { status: 200, data: action };
});
