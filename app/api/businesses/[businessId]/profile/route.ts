import { withApi } from '@/lib/http/handler';
import { parseJsonBody } from '@/lib/http/params';
import { resolveTenantContext } from '@/lib/http/auth-context';
import { wireClient } from '@/lib/http/wiring';
import { updateBusinessProfileSchema } from '@/lib/validation/api-schemas';

/**
 * PATCH /api/businesses/:businessId/profile — requires settings:write (owner/admin).
 */
export const PATCH = withApi(async (request: Request, route) => {
  const { ctx, db } = await resolveTenantContext(request, route.params.businessId);
  const { businesses } = wireClient(db);
  const body = await parseJsonBody(request, updateBusinessProfileSchema);
  return { data: await businesses.updateProfile(ctx, body) };
});
