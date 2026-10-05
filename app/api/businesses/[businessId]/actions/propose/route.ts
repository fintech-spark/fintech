import { withApi } from "@/lib/http/handler";
import { parseJsonBody } from "@/lib/http/params";
import { actionProposalSchema, requestKey, resolveActions } from '../_http';

/**
 * POST /api/businesses/[businessId]/actions/propose
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, actions } = await resolveActions(request, route.params, 'actions:read');
  const body = await parseJsonBody(request, actionProposalSchema);
  const idempotencyKey = requestKey(request);
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
