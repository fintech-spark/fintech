import { withApi } from "@/lib/http/handler";
import { actionId, assertEmptyBody, requestKey, resolveActions } from '../../_http';

/**
 * POST /api/businesses/[businessId]/actions/[id]/execute
 */
export const POST = withApi(async (request: Request, route) => {
  const { ctx, actions } = await resolveActions(request, route.params, 'actions:execute');
  await assertEmptyBody(request);
  const idempotencyKey = requestKey(request);
  const outcome = await actions.execute(ctx, {
    id: actionId(route.params),
    idempotencyKey,
  });
  const status = outcome.executed ? 200 : outcome.denialReason === 'insufficient_role' ? 403 : outcome.denialReason === 'no_registered_executor' ? 422 : outcome.denialReason === undefined ? 422 : 409;
  return { status, data: outcome };
});
