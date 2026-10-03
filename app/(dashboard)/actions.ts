"use server";

// Merchant Brain: dashboard server actions.
//
// Only one action exists today: switching the active business.
//
// The chosen business is written to an httpOnly cookie so client JavaScript
// cannot forge it and it never lands in localStorage. The cookie is a
// *preference*, not an authorisation: the backend re-derives the tenant from
// the session on every request, so pointing the cookie at another business
// grants nothing.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { ACTIVE_BUSINESS_COOKIE } from "@/lib/api/context";
import { getSession } from "@/lib/api/endpoints";

/** A year, but re-validated against the session on every read. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Records the merchant's active business.
 *
 * The id is checked against `GET /api/auth/session` before it is stored. A
 * caller who passes any other value gets an error instead of a cookie — the
 * switcher must never be a way to *try* a business you are not a member of.
 */
export async function switchBusiness(businessId: string): Promise<void> {
  const session = await getSession();

  if (!session.businessIds.includes(businessId)) {
    throw new Error("You are not a member of that business.");
  }

  const jar = await cookies();
  jar.set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });

  // Every screen is tenant-scoped, so the whole route tree is stale after a
  // switch. Revalidating the layout path clears all of it in one call.
  revalidatePath("/", "layout");
}