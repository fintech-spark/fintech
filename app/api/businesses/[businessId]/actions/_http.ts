import { z } from 'zod';
import { assertTrustedOrigin } from '@/lib/auth/http';
import { assertPermission, resolveTenantContext } from '@/lib/http/auth-context';
import { withApi } from '@/lib/http/handler';
import { parseJsonBody, parseUuid } from '@/lib/http/params';
import { wireIntelligence } from '@/lib/http/wiring';
import { NotFoundError, ValidationError } from '@/lib/errors';
import { proposeActionSchema } from '@/lib/validation/api-schemas';
import { ACTION_PARAMETER_SPECS, type ActionType } from '@/modules/actions';

// Extend the existing proposal contract within the assigned lane. Main must
// synchronize generate_report into shared API/frontend contracts.
export const actionProposalSchema = proposeActionSchema.strict().extend({
  type: z.enum(Object.keys(ACTION_PARAMETER_SPECS) as [ActionType, ...ActionType[]]),
});
const emptyBody = z.object({}).strict();
const reasonBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

export async function resolveActions(request: Request, params: Record<string, string>, permission: 'actions:read' | 'actions:approve' | 'actions:execute') {
  assertTrustedOrigin(request);
  const { ctx } = await resolveTenantContext(request, params.businessId);
  assertPermission(ctx, permission);
  return { ctx, actions: wireIntelligence(ctx.businessId).actions };
}

export function actionId(params: Record<string, string>): string {
  return parseUuid(params.id, 'id');
}

export function requestKey(request: Request): string | undefined {
  const key = request.headers.get('idempotency-key') ?? undefined;
  if (key !== undefined && !/^[\x21-\x7e]{1,255}$/.test(key)) throw new ValidationError('Idempotency key must be 1 to 255 printable characters.');
  return key;
}

export async function assertEmptyBody(request: Request): Promise<void> {
  if (request.body !== null) await parseJsonBody(request, emptyBody);
}

type LifecycleOperation = 'draft' | 'submit' | 'approve' | 'reject' | 'cancel' | 'expire';
export function actionMutation(operation: LifecycleOperation) {
  return withApi(async (request, route) => {
    const permission = ['approve', 'reject', 'expire'].includes(operation) ? 'actions:approve' : 'actions:read';
    const { ctx, actions } = await resolveActions(request, route.params, permission);
    const id = actionId(route.params);
    if (operation === 'reject' || operation === 'cancel') {
      const body = request.body === null && operation === 'cancel' ? { reason: 'cancelled by request' } : await parseJsonBody(request, reasonBody);
      return { data: await actions[operation](ctx, id, body.reason) };
    }
    await assertEmptyBody(request);
    return { data: operation === 'submit' ? await actions.requestApproval(ctx, id) : await actions[operation](ctx, id) };
  });
}

export const actionStatus = withApi(async (request, route) => {
  const { ctx, actions } = await resolveActions(request, route.params, 'actions:read');
  const id = actionId(route.params);
  const action = await actions.getById(ctx, id);
  if (action === null) throw new NotFoundError('Action', id);
  return { data: action };
});
