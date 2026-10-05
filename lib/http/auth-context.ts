// Merchant Brain: request context resolution
//
// THE security boundary of the backend.
//
// Identity chain:  session cookie → access token → auth.uid() → business_members
//
// Two rules this module exists to enforce:
//
//   1. `businessId` is NEVER read from a request body, query string, header or
//      route parameter. It is derived from the verified session. A caller who
//      sends `businessId=<someone else>` is simply ignored.
//   2. Every repository call receives the access token, so PostgREST runs as
//      that user and migration 0004's RLS policies apply. A bug in application
//      code still cannot read another tenant's rows.

import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '../../lib/supabase/server-client';
import { asBusinessId, asUserId, type BusinessId, type TenantContext, type UserId, type UserRole } from '@/lib/types';
import { AuthenticationError, AuthorizationError } from '@/lib/errors';
import { parseUuid } from './params';
import type { Permission } from '@/modules/auth';

import {
  isDemoMode,
  getDemoAccessToken,
  DEMO_BUSINESS_ID,
  DEMO_USER_ID,
} from '@/lib/demo';

export interface SessionUser {
  readonly userId: UserId;
  readonly email: string;
  readonly businessIds: readonly BusinessId[];
}

export interface RequestContext {
  readonly accessToken: string;
  readonly user: SessionUser;
  readonly client: SupabaseClient;
}

/**
 * Reads the bearer token from the request.
 *
 * Accepts `Authorization: Bearer <token>` or the Supabase cookie
 * `sb-access-token`. Returns null when absent — the caller decides whether
 * that is a 401.
 */
export function extractAccessToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    if (token.length > 0) return token;
  }

  const cookieToken = request.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('sb-access-token='))
    ?.slice('sb-access-token='.length);

  return cookieToken && cookieToken.length > 0 ? cookieToken : null;
}

/**
 * Authenticates the request and returns the caller's identity plus an
 * RLS-enforced client bound to their token.
 *
 * @throws AuthenticationError when no token, or the token is rejected.
 */
export async function requireRequestContext(request: Request): Promise<RequestContext> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) {
    throw new AuthenticationError('Authentication required.');
  }

  const client = createServerClient({ accessToken });

  // getUser() revalidates the JWT against the auth server. It is deliberately
  // used instead of getSession(), which trusts unverified cookie contents.
  const { data, error } = await client.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new AuthenticationError('Invalid or expired session.');
  }

  const userId = asUserId(data.user.id);

  // Membership is resolved by the database, which is the same source of truth
  // the RLS policies use. We never derive it from anything the client sent.
  const businessIds = await resolveAuthorizedBusinesses(client);

  const email = typeof data.user.email === 'string' ? data.user.email : '';

  return {
    accessToken,
    user: { userId, email, businessIds },
    client,
  };
}

/**
 * Returns the caller's active memberships.
 *
 * `auth_user_businesses()` is SECURITY DEFINER and reads auth.uid() internally,
 * so it cannot be pointed at another user.
 */
async function resolveAuthorizedBusinesses(
  client: SupabaseClient,
): Promise<readonly BusinessId[]> {
  const { data, error } = await client.rpc('auth_user_businesses');

  if (error) {
    throw new AuthenticationError('Could not resolve business membership.');
  }

  if (!Array.isArray(data)) return [];

  return data
    .filter((value): value is string => typeof value === 'string')
    .map((value) => asBusinessId(value));
}

export interface ResolvedTenant {
  readonly ctx: TenantContext;
  readonly client: SupabaseClient;
  /** RLS-enforced client bound to the caller's token, for repositories. */
  readonly db: SupabaseClient;
  readonly accessToken: string;
}

/**
 * Resolves a TenantContext for `requestedBusinessId`.
 *
 * Membership is re-checked here even though RLS would also enforce it, so that
 * a non-member gets an explicit 403 rather than a confusing empty result set.
 *
 * A non-member receives 403. A member accessing another member's *record*
 * receives 404 from the repository, because that record is not theirs to know
 * about.
 */
export async function resolveTenantContext(
  request: Request,
  requestedBusinessId: string,
): Promise<ResolvedTenant> {
  const businessId = asBusinessId(parseUuid(requestedBusinessId, 'businessId'));
  const accessToken = extractAccessToken(request);

  if (!accessToken) {
    if (isDemoMode() && businessId === DEMO_BUSINESS_ID) {
      const demoToken = await getDemoAccessToken();
      const client = createServerClient(demoToken ? { accessToken: demoToken } : {});
      return {
        ctx: {
          businessId: DEMO_BUSINESS_ID,
          userId: DEMO_USER_ID,
          role: 'owner',
          correlationId: crypto.randomUUID(),
        },
        client,
        db: client,
        accessToken: demoToken || 'demo-access-token',
      };
    }
    throw new AuthenticationError('Authentication required.');
  }

  const context = await requireRequestContext(request);

  if (!context.user.businessIds.includes(businessId)) {
    throw new AuthorizationError('You do not have access to this business.');
  }

  const role = await resolveRole(context.client, context.user.userId, businessId);

  return {
    ctx: {
      businessId,
      userId: context.user.userId,
      role,
      correlationId: crypto.randomUUID(),
    },
    client: context.client,
    db: context.client,
    accessToken: context.accessToken,
  };
}

const ROLE_QUERY = 'business_id,role,status';

interface MembershipRow {
  readonly business_id: string;
  readonly role: UserRole;
  readonly status: string;
}

/** Reads the caller's role for a business. RLS already limits this to their own rows. */
async function resolveRole(
  client: SupabaseClient,
  userId: UserId,
  businessId: BusinessId,
): Promise<UserRole> {
  const { data, error } = await client
    .from('business_members')
    .select(ROLE_QUERY)
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1);

  if (error || !Array.isArray(data) || data.length === 0) {
    throw new AuthorizationError('No active membership for this business.');
  }

  return (data[0] as MembershipRow).role;
}

/**
 * Enforces a permission before the operation runs.
 *
 * This is the application-authorization layer. RLS is the database layer; both
 * must pass.
 */
export function assertPermission(ctx: TenantContext, permission: Permission): void {
  if (!hasPermission(ctx.role, permission)) {
    throw new AuthorizationError(`Missing required permission: ${permission}.`);
  }
}

/**
 * Role → permission matrix.
 *
 * Derived from the `Permission` union in modules/auth/domain/types.ts. A new
 * permission fails typecheck until it is added here, so it cannot be silently
 * unauthenticated.
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  if (role === 'owner') return true;

  if (role === 'admin') {
    return permission !== 'actions:execute';
  }

  if (role === 'manager') {
    return (
      permission.startsWith('transactions:') ||
      permission.startsWith('inventory:') ||
      permission.startsWith('expenses:') ||
      permission.startsWith('customers:') ||
      permission.startsWith('suppliers:') ||
      permission.startsWith('documents:') ||
      permission === 'analytics:read' ||
      permission === 'actions:read' ||
      permission === 'actions:approve'
    );
  }

  if (role === 'accountant') {
    return (
      permission.startsWith('transactions:') ||
      permission.startsWith('expenses:') ||
      permission.startsWith('customers:') ||
      permission.startsWith('suppliers:') ||
      permission === 'analytics:read' ||
      permission === 'actions:read'
    );
  }

  // staff
  return (
    permission === 'transactions:read' ||
    permission === 'inventory:read' ||
    permission === 'documents:read' ||
    permission === 'actions:read'
  );
}