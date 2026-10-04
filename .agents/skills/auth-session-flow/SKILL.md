---
name: auth-session-flow
description: Trace, implement, or debug the Supabase session lifecycle in this repo. Use when working on app/api/auth/*, lib/auth/*, login/signup/logout/refresh/forgot-password, session cookies, 401 vs 403 responses, CSRF/origin rejection, auth rate limiting, or when sign-in "does not work", returns 502, or leaves the user unauthenticated. Encodes the cookie contract, the JWT revalidation step, and the anon-key guard.
---

# Auth and session flow

Merchant Brain uses Supabase Auth with **httpOnly cookies** and an RLS-backed per-user client.
There is no `middleware.ts`; session establishment happens entirely in route handlers.

## Cookie contract (`lib/auth/session.ts`)

| Cookie | Purpose | Flags |
|---|---|---|
| `sb-access-token` | the user's JWT, read by every protected route | httpOnly, SameSite=Lax, `secure` in production |
| `sb-refresh-token` | **only** ever sent to `/api/auth/refresh` | httpOnly, SameSite=Lax |
| `mb_active_business` | UI hint for which business is selected | httpOnly; intersected with session ids, never authoritative |

`extractAccessToken` (`lib/http/auth-context.ts:44`) accepts `Authorization: Bearer` **or** the
cookie. Cookie is the browser path; Bearer is for server-to-server.

## The verification chain — never skip a step

1. Extract token → missing ⇒ **401** (`auth-context.ts:70`)
2. `createServerClient({ accessToken })` — the per-user client, so PostgREST sets
   `request.jwt.claims` and `auth.uid()` resolves inside the RLS policies
3. `client.auth.getUser(accessToken)` — **revalidates the JWT with the auth server**. Skipping this
   means trusting an unverified signature
4. `rpc('auth_user_businesses')` — the caller's active memberships, from the database
5. Membership check on the path param ⇒ **403** if absent
6. `resolveRole` reads the active `business_members` row ⇒ **403** if none

A token that verifies but has no membership is **403**, not 401.

## Endpoints

`/api/auth/login` (IP 20/min + IP+email 5/min), `/signup` (IP 5/min; 200 with a session vs 202
when email confirmation is required), `/logout` (revokes locally, clears cookies regardless),
`/refresh` (rotates; on 401 clears cookies), `/forgot-password` (IP 10/min + email 3/min),
`/session` (authenticated; returns `userId`, `email`, `businessIds`).

All wrapped in `withAuthApi`, which applies `assertTrustedOrigin` — Origin **and** `Sec-Fetch-Site`
must be same-origin or absent for state-changing methods.

## Gotchas

- **`SUPABASE_ANON_KEY` must be a real JWT.** `assertUsableAnonKey` (`lib/auth/supabase.ts`) rejects
  empty or placeholder values (anything not matching `^eyJ[A-Za-z0-9_-]+\.`) with a precise server
  log naming the variable. A placeholder produces a generic 502 to the user and a clear log line
  for you — that asymmetry is intentional, so never echo the config detail to the client.
- **Bad credentials are 401, not 403.** `invalid_credentials` / `invalid_grant` / `session_not_found`
  map to `AuthenticationError`. `email_not_confirmed` maps to 403. The refresh route keys
  cookie-clearing off 401, so getting this wrong strands the client in a refresh loop.
- **Never forward an upstream error string.** `mapAuthError` returns messages we wrote; Supabase
  distinguishes "no such user" from "wrong password", which is a user-enumeration oracle.
- **Duplicate signup is not an error from the provider.** Supabase answers an existing email with a
  user that has **no identities**; detect `identities.length === 0` and throw `ConflictError` (409).
- Logout revocation is best-effort with a 5s timeout — cookies are cleared either way, so a user is
  never stuck signed in because GoTrue was unreachable.
- Origin comparison derives from `request.url`, not a configured constant. Do not reintroduce an
  env-var read here: `tests/frontend/security.test.ts` fails the build on any `NEXT_PUBLIC_`
  literal in `app/`, `components/`, or `lib/`.
- Rate limits are in-process and bounded (10k buckets, oldest-half eviction). They reset on deploy
  and are not shared across instances.

## Validation

```bash
npx vitest run tests/auth
npm run typecheck && npm run build
```

For runtime proof, `npm run dev` and exercise the round trip: signup → login → `/api/auth/session`
→ refresh → logout, then confirm a protected API returns 401 without the cookie and 403 with a
valid cookie for a non-member business.

## References

- `.agents/rules/security.md` — standing security policy
- `.agents/skills/nextjs-supabase-auth/SKILL.md` — general App Router + Supabase patterns
