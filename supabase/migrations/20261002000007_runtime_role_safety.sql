-- Merchant Brain: Database Security — Runtime Role Safety Invariants
-- Migration 0006: closes the Model 3 red-team finding that the application's
-- runtime database connection used a role with rolbypassrls = true, which
-- silently disabled every RLS policy in migration 0004.
--
-- Reproduced by Model 3 (see .phase2/COORDINATION.md, finding RT-1..RT-5):
-- connected as `postgres` (rolbypassrls = true), all five cross-tenant
-- SELECT / UPDATE / INSERT / DELETE / child-INSERT attacks SUCCEEDED.
--
-- ---------------------------------------------------------------------------
-- DESIGN NOTE — why there is no new application role in this migration
-- ---------------------------------------------------------------------------
-- A separate least-privilege NOLOGIN group role was trialled here and removed.
-- Every RLS policy in 0004 resolves auth.uid(), and Postgres resolves function
-- references inside a policy expression using the *invoking* role. A new role
-- therefore needs USAGE on schema `auth`.
--
-- That grant cannot be issued from this project's migration role: schema
-- `auth` is owned by `supabase_admin`, and `GRANT USAGE ON SCHEMA auth TO
-- <role>` executed by `postgres` returns success while leaving the ACL
-- unchanged (verified empirically — nspacl still lists only supabase_admin,
-- anon, authenticated, service_role, supabase_auth_admin, dashboard_user,
-- postgres; has_schema_privilege() stays false).
--
-- A role that cannot evaluate the policies is therefore useless: it fails
-- closed on every query and would break the application while appearing
-- "secured". Rather than ship that trap, user-facing queries run as
-- `authenticated` — the role Supabase already provisions with schema `auth`
-- USAGE — with the verified caller's JWT claims set per request. The code-side
-- enforcement that prevents a bypassrls connection from ever being used for
-- tenant data lives in lib/database/postgres-client.ts (assertTenantSafe) and
-- lib/supabase/ (server-only admin client).

-- ============================================================================
-- 1. Fail fast if a user-facing role could silently bypass RLS.
--    auth_user_businesses() and auth_user_admin_businesses() are SECURITY
--    DEFINER; if the roles allowed to call them could bypass RLS, the whole
--    membership model would be advisory rather than enforced.
--
--    service_role intentionally has BYPASSRLS in Supabase — it is the trusted
--    backend role for trusted server-side code. That is acceptable ONLY because
--    it is reachable exclusively through the server-only admin client and its
--    key is a secret. anon and authenticated are the only roles a browser
--    token can ever resolve to, so those are what must stay clean.
-- ============================================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname IN ('anon', 'authenticated')
      AND (rolsuper OR rolbypassrls)
  LOOP
    RAISE EXCEPTION
      'SECURITY: user-facing role % has superuser=%, bypassrls=%; it must not be able to bypass RLS',
      r.rolname, r.rolsuper, r.rolbypassrls;
  END LOOP;

  -- service_role must never be reachable by a browser-facing role, otherwise
  -- the trusted-backend assumption above is void.
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members am
    JOIN pg_roles granted ON granted.oid = am.roleid
    JOIN pg_roles member ON member.oid = am.member
    WHERE granted.rolname = 'service_role'
      AND member.rolname IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION
      'SECURITY: service_role is a member of a user-facing role; privilege escalation path';
  END IF;
END $$;

-- ============================================================================
-- 2. User-facing roles must not be able to alter the schema they are policed
--    by. Without this an authenticated user could drop or redefine a policy
--    and remove their own constraints.
-- ============================================================================
REVOKE CREATE ON SCHEMA public FROM anon, authenticated;
REVOKE CREATE ON SCHEMA extensions FROM anon, authenticated;

-- ============================================================================
-- 3. The SECURITY DEFINER membership helpers stay callable only by the roles
--    that need them. Re-asserted here so the grants are pinned even if a
--    later migration widens them by accident.
-- ============================================================================
REVOKE ALL ON FUNCTION public.auth_user_businesses() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_admin_businesses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_businesses() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_admin_businesses() TO authenticated, anon;

-- Only the owning roles may replace the functions that enforce the boundary.
REVOKE ALL ON FUNCTION public.prevent_business_id_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_parent_id_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_business_id_mutation() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_parent_id_mutation() FROM anon, authenticated;

-- ============================================================================
-- 4. Remove the trial role from the earlier draft of this migration if a
--    previous run created it. It cannot evaluate the RLS policies (see design
--    note) and would silently deny all legitimate traffic, so it must not
--    linger as an apparent security improvement.
--
--    DROP OWNED BY is deliberately not used: it requires privileges this
--    project's migration role does not hold on Supabase Cloud
--    ("permission denied to drop objects"). Each privilege granted earlier is
--    therefore revoked explicitly, then the role is dropped. Every statement is
--    best-effort so the migration is idempotent on a clean database.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merchant_app') THEN
    EXECUTE 'REVOKE merchant_app FROM postgres';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM merchant_app';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM merchant_app';
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM merchant_app';
    EXECUTE 'REVOKE USAGE ON SCHEMA extensions FROM merchant_app';
    EXECUTE 'REVOKE USAGE ON SCHEMA auth FROM merchant_app';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.auth_user_businesses() FROM merchant_app';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.auth_user_admin_businesses() FROM merchant_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM merchant_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM merchant_app';
    EXECUTE 'DROP ROLE IF EXISTS merchant_app';
  END IF;
END $$;

-- Post-condition: the unusable role must be gone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'merchant_app') THEN
    RAISE EXCEPTION 'SECURITY: merchant_app could not be removed; drop it manually with a superuser role';
  END IF;
END $$;