import { cookies } from 'next/headers';
import { withApi } from '@/lib/http/handler';
import { requireRequestContext } from '@/lib/http/auth-context';
import { parseJsonBody } from '@/lib/http/params';
import { wire, wireClient } from '@/lib/http/wiring';
import { createBusinessSchema } from '@/lib/validation/api-schemas';
import { ACTIVE_BUSINESS_COOKIE } from '@/lib/api/context';

/**
 * GET /api/businesses
 *
 * Businesses the caller is an active member of. There is no tenant parameter
 * to forge: RLS filters the query and the service additionally predicates on
 * the authenticated user id.
 */
export const GET = withApi(async (request: Request) => {
  const context = await requireRequestContext(request);
  const { db } = wire(context.accessToken);
  const { businesses } = wireClient(db);
  const list = await businesses.listForUser(context.user.userId);

  return {
    data: list.map((b) => ({ id: b.id, name: b.name, type: b.type, status: b.status })),
  };
});

/**
 * POST /api/businesses
 *
 * Provisions a new business and assigns the authenticated user as owner.
 * Sets the active business cookie so immediate client navigation uses the new tenant.
 */
export const POST = withApi(async (request: Request) => {
  const context = await requireRequestContext(request);
  const body = await parseJsonBody(request, createBusinessSchema);
  const { db } = wire(context.accessToken);
  const { businesses } = wireClient(db);

  const created = await businesses.create(context.user.userId, {
    name: body.name,
    type: body.type,
    profile: body.profile,
    settings: body.settings,
  });

  try {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_BUSINESS_COOKIE, created.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
  } catch {
    // Non-fatal if invoked in an environment where cookies() cannot set headers
  }

  return {
    data: { id: created.id, name: created.name, type: created.type, status: created.status },
    status: 201,
  };
});
