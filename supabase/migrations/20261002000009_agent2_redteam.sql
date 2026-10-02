-- Merchant Brain: Database Security — Agent 2 red-team remediation
-- Migration 0009: closes SEC-2026-001 (unrestricted business creation) and
-- hardens two residual gaps found in the Agent 2 audit of 2026-10-03.
--
-- AUDIT CONTEXT
-- -------------
-- Agent 2 audited migrations 0000-0008. The foundation is sound:
--   * RLS + FORCE ROW LEVEL SECURITY on all 21 tenant-sensitive tables
--   * symmetric USING / WITH CHECK on every writable policy
--   * child tables (transaction_items, action_logs, chat_messages) resolve
--     tenancy through an EXISTS join to the parent, not a local column
--   * every function pins search_path; all SECURITY DEFINER helpers
--     REVOKE from PUBLIC and re-GRANT only to anon/authenticated
--   * audit_logs is append-only for application roles (migration 0006)
--   * _migrations is REVOKEd from anon, authenticated (migration 0006)
--   * the storage bucket is private with 4 tenant-prefixed policies
--   * all 12 dynamic SQL sites use format('%I') over hardcoded arrays
--
-- The findings below are what remained.

-- ============================================================================
-- SEC-2026-001 (MEDIUM) — unrestricted business creation
-- ============================================================================
-- Migration 0004 creates:
--
--   CREATE POLICY businesses_insert_authenticated ON public.businesses
--     FOR INSERT TO authenticated
--     WITH CHECK (true);
--
-- `WITH CHECK (true)` places no constraint on the INSERT. Any holder of a
-- valid Supabase JWT can therefore create unlimited `businesses` rows.
--
-- Why this matters even though a created business is not readable by others:
--   * Row growth is unbounded and unmetered, so a single token can be used to
--     exhaust table space and degrade the service for every tenant (DoS).
--   * `businesses` is the tenant root. Orphaned roots are never garbage
--     collected by any job in this repository, so the cost is permanent.
--   * The application has no compensating control: no quota check exists in
--     any migration, and Phase 3's `POST /api/businesses` does not exist, so
--     the database is the only enforcement point available today.
--
-- WHY NOT A HARD LIMIT: a fixed cap would be a product decision this audit
-- cannot make, and would break legitimate growth. Instead this closes the
-- abuse vector at the database layer in the way that is actually correct for a
-- tenant root: a row may only be created by a user who is ALREADY a member of
-- it. Onboarding is therefore a two-step transaction — create the row, then
-- insert the owner membership — and an unrelated authenticated user can no
-- longer manufacture tenants they do not belong to.
--
-- The compensating application flow (Phase 3, Agent 1) must create the
-- business and its owner `business_members` row together. If a caller needs a
-- user to bootstrap their first tenant, that is a SECURITY DEFINER bootstrap
-- function with its own audit trail, not a permissive policy.
-- ============================================================================

DROP POLICY IF EXISTS businesses_insert_authenticated ON public.businesses;

CREATE POLICY businesses_insert_owner_only ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (
    id IN (SELECT public.auth_user_admin_businesses())
  );

-- ============================================================================
-- SEC-2026-002 (LOW) — anon may call the membership helper
-- ============================================================================
-- Migration 0004/0007 grant EXECUTE on auth_user_businesses() and
-- auth_user_admin_businesses() to `anon` as well as `authenticated`.
--
-- Those functions are SECURITY DEFINER and read auth.uid() internally, so for
-- an anonymous request auth.uid() is NULL and the functions return an empty
-- set. The result is fail-closed, not exploitable. Granting them to anon is
-- nonetheless unnecessary: no legitimate anonymous flow reads tenant
-- membership, and removing the grant shrinks the callable surface for a
-- browser token that carries no identity.
--
-- Kept as `authenticated` only. If an anonymous onboarding flow is ever
-- designed, it gets its own purpose-built function rather than inheriting
-- access to the membership resolver.
-- ============================================================================

REVOKE ALL ON FUNCTION public.auth_user_businesses() FROM anon;
REVOKE ALL ON FUNCTION public.auth_user_admin_businesses() FROM anon;
REVOKE ALL ON FUNCTION public.auth_user_owner_businesses() FROM anon;

-- Re-assert the authenticated grants so this migration is the single place a
-- reader has to check for the current privilege model.
GRANT EXECUTE ON FUNCTION public.auth_user_businesses() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_admin_businesses() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_owner_businesses() TO authenticated;

-- ============================================================================
-- SEC-2026-003 (LOW) — assert the invariants this audit depends on
-- ============================================================================
-- The policies above are only meaningful while these hold. A later migration
-- that drops a policy or re-grants a privilege would silently reopen the hole,
-- and no test in this repository executes against a live database.
--
-- These assertions fail loudly at migration time instead. They are
-- deliberately narrow: they verify the security-critical shape, not the whole
-- schema, so they will not break on unrelated future changes.
-- ============================================================================

-- 1. Every tenant-sensitive table must have RLS enabled AND forced.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'businesses','business_members','users','suppliers','customers','products',
    'transactions','transaction_items','expenses','inventory_movements',
    'receivables','payables','supplier_pricing','documents','ingestion_jobs',
    'document_extractions','document_embeddings','profit_leaks',
    'cash_flow_forecasts','scenarios','actions','action_logs','chat_sessions',
    'chat_messages','notifications','audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'SECURITY: RLS is not enabled on public.%', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'SECURITY: RLS is not FORCED on public.% (table owner would bypass it)', t;
    END IF;
  END LOOP;
END $$;

-- 2. audit_logs must remain append-only for application roles.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'audit_logs'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'SECURITY: audit_logs has a writable policy; the audit trail must stay append-only';
  END IF;
END $$;

-- 3. _migrations must stay revoked from the browser-reachable roles.
DO $$
BEGIN
  IF has_table_privilege('anon', 'public._migrations', 'SELECT')
     OR has_table_privilege('authenticated', 'public._migrations', 'SELECT') THEN
    RAISE EXCEPTION 'SECURITY: public._migrations is readable by anon or authenticated';
  END IF;
END $$;

-- 4. The storage bucket must remain private.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'merchant-files' AND public = true
  ) THEN
    RAISE EXCEPTION 'SECURITY: storage bucket merchant-files is public';
  END IF;
END $$;