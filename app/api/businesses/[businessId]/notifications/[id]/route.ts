import { withApi } from '@/lib/http/handler';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireIntelligence } from '@/lib/http/wiring';

/**
 * PATCH /api/businesses/[businessId]/notifications/[id] — mark notification read.
 */
export const PATCH = withApi(async (request: Request, route) => {
  const { ctx } = await resolveTenantContext(request, route.params.businessId);
  const { notifications } = wireIntelligence(ctx.businessId);
  await notifications.markAsRead(ctx, route.params.id);
  return { status: 200, data: { success: true } };
});
