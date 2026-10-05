// Merchant Brain: Demo Mode configuration and tenant context
//
// Governed by DEMO_MODE environment variable.
// Provides controlled access to the dedicated demo tenant ("Sharma General Store")
// for unauthenticated visitors during demo/hackathon evaluations.
//
// INVARIANTS:
// 1. Unauthenticated demo access is ONLY granted to DEMO_BUSINESS_ID.
// 2. Real authenticated sessions are NEVER bypassed and follow normal tenant resolution.
// 3. No arbitrary client-supplied business IDs can ever be accessed.

import 'server-only';

import { asBusinessId, asUserId, type BusinessId, type UserId } from '@/lib/types';
import type { WireBusinessSummary, WireSession } from '@/lib/api/contracts';
import type { AuthenticatedMerchantContext } from '@/lib/api/context';
import { createServerClient } from '@/lib/supabase/server-client';

export const DEMO_BUSINESS_ID: BusinessId = asBusinessId(
  process.env.DEMO_BUSINESS_ID || 'd88192ec-e81a-452a-8b45-497322741044',
);

export const DEMO_USER_ID: UserId = asUserId(
  process.env.DEMO_USER_ID || '8d3aa805-7a15-4a74-bb26-cb140121c44f',
);

export const DEMO_USER_EMAIL = process.env.DEMO_USER_EMAIL || 'demo@merchantbrain.internal';
export const DEMO_USER_PASSWORD = process.env.DEMO_USER_PASSWORD || 'DemoPassword123!';
export const DEMO_BUSINESS_NAME = 'Sharma General Store';

export function isDemoMode(): boolean {
  // Enabled by default for hackathon demo unless explicitly set to 'false'
  return process.env.DEMO_MODE !== 'false';
}

export const DEMO_BUSINESS_SUMMARY: WireBusinessSummary = {
  id: DEMO_BUSINESS_ID,
  name: DEMO_BUSINESS_NAME,
  type: 'food_beverage',
  status: 'active',
};

export const DEMO_SESSION: WireSession = {
  userId: DEMO_USER_ID,
  email: DEMO_USER_EMAIL,
  businessIds: [DEMO_BUSINESS_ID],
};

export function getDemoMerchantContext(): AuthenticatedMerchantContext {
  return {
    status: 'authenticated',
    session: DEMO_SESSION,
    businesses: [DEMO_BUSINESS_SUMMARY],
    activeBusinessId: DEMO_BUSINESS_ID,
    activeBusiness: DEMO_BUSINESS_SUMMARY,
    members: [
      {
        businessId: DEMO_BUSINESS_ID,
        userId: DEMO_USER_ID,
        role: 'owner',
        joinedAt: '2026-10-04T19:18:02.866Z',
        status: 'active',
      },
    ],
  };
}

let cachedDemoToken: { token: string; expiresAt: number } | null = null;

export async function getDemoAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedDemoToken && cachedDemoToken.expiresAt > now + 60_000) {
    return cachedDemoToken.token;
  }

  try {
    const client = createServerClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: DEMO_USER_EMAIL,
      password: DEMO_USER_PASSWORD,
    });

    if (error || !data.session?.access_token) {
      return null;
    }

    const expiresIn = data.session.expires_in ?? 3600;
    cachedDemoToken = {
      token: data.session.access_token,
      expiresAt: now + expiresIn * 1000,
    };
    return data.session.access_token;
  } catch {
    return null;
  }
}
