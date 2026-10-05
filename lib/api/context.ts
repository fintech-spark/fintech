// Merchant Brain: tenant context resolution.
//
// Answers one question before any page renders: *which business am I acting
// on, and am I allowed to?*
//
// Rules this file enforces (AI_CONTEXT.md §6):
//   - The active `businessId` comes from `GET /api/auth/session`, never from a
//     query string a merchant could edit.
//   - The switcher's current choice lives in an httpOnly cookie, so client
//     JavaScript cannot forge it and it never lands in localStorage.
//   - Every read is `no-store`, so there is no cross-tenant cache entry that a
//     business switch could reveal.

import "server-only";

import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/session";
import { isDemoMode, getDemoMerchantContext } from "@/lib/demo";
import { ApiError, CapabilityUnavailableError } from "./errors";
import { getSession, listBusinesses, listMembers } from "./endpoints";
import type { WireBusinessSummary, WireSession } from "./contracts";

export const ACTIVE_BUSINESS_COOKIE = "mb_active_business";

export interface AuthenticatedMerchantContext {
  readonly status: "authenticated";
  readonly session: WireSession;
  readonly businesses: readonly WireBusinessSummary[];
  /** Always a member of `businesses`. Never taken from the request. */
  readonly activeBusinessId: string;
  readonly activeBusiness: WireBusinessSummary;
  readonly members: readonly {
    readonly businessId: string;
    readonly userId: string;
    readonly role: "owner" | "admin" | "manager" | "accountant" | "staff";
    readonly joinedAt: string;
    readonly status: "active" | "invited" | "removed";
  }[];
}

/** Fresh user signed in but without any businesses yet. Ready for onboarding. */
export interface OnboardingMerchantContext {
  readonly status: "onboarding";
  readonly session: WireSession;
}

/** No valid session. The merchant must sign in. */
export interface UnauthenticatedContext {
  readonly status: "unauthenticated";
}

/**
 * The API this app talks to is not reachable — for example while the backend
 * branch has not been merged. This is a real state and is labelled as such;
 * it is never shown as "no data".
 */
export interface BackendUnavailableContext {
  readonly status: "backend_unavailable";
  readonly capability: string;
}

export type MerchantContext =
  | AuthenticatedMerchantContext
  | OnboardingMerchantContext
  | UnauthenticatedContext
  | BackendUnavailableContext;

/**
 * Resolves the merchant's tenant context.
 *
 * Never throws: pages branch on `status` so a missing backend or an expired
 * session produces an honest screen instead of an error boundary.
 */
export async function resolveMerchantContext(): Promise<MerchantContext> {
  const cookieJar = await cookies();
  const hasAccessToken = Boolean(cookieJar.get(ACCESS_TOKEN_COOKIE)?.value.trim());
  const hasScenario = cookieJar.has("mb_e2e_scenario");

  // Fast path: if the caller presents no session cookie (and is not exercising
  // a synthetic E2E scenario in tests), they are unauthenticated.
  // In demo mode, unauthenticated visitors resolve to the controlled demo tenant.
  if (!hasAccessToken && !hasScenario) {
    if (isDemoMode()) {
      return getDemoMerchantContext();
    }
    return { status: "unauthenticated" };
  }

  let session: WireSession;
  try {
    session = await getSession();
  } catch (error) {
    if (error instanceof CapabilityUnavailableError) {
      return {
        status: "backend_unavailable",
        capability: "Signing in",
      };
    }
    if (error instanceof ApiError && error.isUnauthenticated) {
      if (isDemoMode()) {
        return getDemoMerchantContext();
      }
      return { status: "unauthenticated" };
    }
    // If the session check fails and there is no verified access token (and
    // this is not an E2E scenario testing backend error), surface as unauthenticated.
    if (!hasAccessToken && !hasScenario) {
      if (isDemoMode()) {
        return getDemoMerchantContext();
      }
      return { status: "unauthenticated" };
    }
    // A network or contract failure is not an auth state. Surface it as
    // unavailable so the page can offer a retry instead of a false sign-out.
    return { status: "backend_unavailable", capability: "Signing in" };
  }

  let businesses: readonly WireBusinessSummary[];
  try {
    businesses = await listBusinesses();
  } catch (error) {
    if (error instanceof CapabilityUnavailableError) {
      return {
        status: "backend_unavailable",
        capability: "Your businesses",
      };
    }
    if (error instanceof ApiError && error.isUnauthenticated) {
      return { status: "unauthenticated" };
    }
    return { status: "backend_unavailable", capability: "Your businesses" };
  }

  // The session lists ids the caller may use; the businesses endpoint returns
  // the same set with names. Intersect them so a stale cookie can never point
  // the UI at a business the server has removed from the session.
  const authorized = new Set(session.businessIds);
  const permitted = businesses.filter((business) => authorized.has(business.id));

  if (permitted.length === 0) {
    // Signed in, but attached to no business yet. That is an onboarding
    // state, not an unauthenticated state.
    return { status: "onboarding", session };
  }

  const requested = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  const activeBusiness =
    permitted.find((business) => business.id === requested) ?? permitted[0];

  let members: AuthenticatedMerchantContext["members"] = [];
  try {
    members = await listMembers(activeBusiness.id);
  } catch {
    // The team list is supporting context for the shell. A failure here must
    // not take down the whole application.
    members = [];
  }

  return {
    status: "authenticated",
    session,
    businesses: permitted,
    activeBusinessId: activeBusiness.id,
    activeBusiness,
    members,
  };
}

export function isAuthenticated(
  context: MerchantContext,
): context is AuthenticatedMerchantContext {
  return context.status === "authenticated";
}
