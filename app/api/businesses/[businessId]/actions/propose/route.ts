import { withApi } from "@/lib/http/handler";
import { resolveTenantContext } from "@/lib/http/auth-context";
import { parseJsonBody } from "@/lib/http/params";
import { wireIntelligence } from "@/lib/http/wiring";
import { proposeActionSchema } from "@/lib/validation/api-schemas";

/**
 * POST /api/businesses/[businessId]/actions/propose
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  const { actions } = wireIntelligence(ctx.businessId);
  const body = await parseJsonBody(request, proposeActionSchema);
  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  const action = await actions.propose(ctx, {
    type: body.type,
    title: body.title,
    description: body.description,
    source: body.source,
    parameters: body.parameters,
    idempotencyKey,
    relatedLeakId: body.relatedLeakId,
    relatedRiskId: body.relatedRiskId,
  });
  return { status: 201, data: action };
});
