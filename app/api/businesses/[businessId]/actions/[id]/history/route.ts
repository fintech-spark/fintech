import { withApi } from '@/lib/http/handler';
import { NotFoundError } from '@/lib/errors';
import { actionId, resolveActions } from '../../_http';

export const GET = withApi(async (request, route) => {
  const { ctx, actions } = await resolveActions(request, route.params, 'actions:read');
  const id = actionId(route.params);
  if (await actions.getById(ctx, id) === null) throw new NotFoundError('Action', id);
  return { data: await actions.listAudit(ctx, id) };
});
