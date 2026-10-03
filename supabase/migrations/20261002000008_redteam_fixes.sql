-- Merchant Brain: Database Security — Model 3 red-team fixes
-- Migration 0008: two defects found by red-team testing against the live
-- database. Both were reproduced before being fixed; see
-- .phase2/COORDINATION.md findings M3-001 and M3-002.
--
-- ---------------------------------------------------------------------------
-- M3-001 (CRITICAL, availability): prevent_parent_id_mutation() was broken on
-- every table it was attached to.
--
-- The function opened with:
--     IF TG_ARGV[0] = 'transaction_id' AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
-- and so on for action_id / session_id / supplier_id / customer_id / user_id / id.
--
-- PL/pgSQL plans a whole IF condition as one SQL expression, so it resolves
-- EVERY NEW.<column> reference up front. Short-circuiting does not help: the
-- record field lookup happens at plan time. On business_members (which has no
-- transaction_id) the trigger therefore raised:
--     ERROR: record "new" has no field "transaction_id"
--
-- Reproduced: UPDATE on users, business_members, transaction_items, action_logs,
-- chat_messages, notifications and chat_sessions all failed with that error.
-- The guard was effectively a blanket UPDATE denial on those tables. It fails
-- closed so it leaked nothing, but it made the tables unusable and meant the
-- immutability guarantee rested on an unrelated crash rather than on the
-- intended comparison.
--
-- Fix: compare through to_jsonb() so a missing column yields NULL instead of
-- raising, and drive the comparison from TG_ARGV[0] directly. This works for
-- any (table, column) pair, including columns added later.
--
-- ---------------------------------------------------------------------------
-- M3-002 (HIGH, privilege escalation): an 'admin' could INSERT an 'owner'
-- membership row.
--
-- migration 0006 added prevent_membership_role_escalation() to stop an admin
-- promoting itself to owner, but it is a BEFORE UPDATE trigger only. The
-- INSERT side was unguarded, and business_members_insert_admin only checks
-- that the *inserter* is an admin of the target business -- it does not
-- restrict which role may be granted.
--
-- Reproduced: an 'admin' inserted business_members(business_id, role='owner')
-- for a second account it controls, minting an owner.
--
-- Fix: extend the guard to INSERT so granting 'owner' always requires the
-- caller to already be an owner of that business.

-- ============================================================================
-- 1. M3-001 — generic, table-agnostic parent/ownership column immutability
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_parent_id_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  col text := TG_ARGV[0];
  new_val jsonb;
  old_val jsonb;
BEGIN
  IF col IS NULL OR col = '' THEN
    RAISE EXCEPTION 'prevent_parent_id_mutation: trigger argument (column name) is required';
  END IF;

  -- to_jsonb() turns a missing column into SQL NULL rather than raising
  -- "record new has no field X", which is what made the previous version
  -- unusable on tables that lack one of the hard-coded column names.
  new_val := to_jsonb(NEW) -> col;
  old_val := to_jsonb(OLD) -> col;

  IF new_val IS DISTINCT FROM old_val THEN
    RAISE EXCEPTION 'ownership violation: % is immutable on %.%', col, TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_parent_id_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_parent_id_mutation() FROM anon, authenticated;

-- ============================================================================
-- 2. M3-002 — role/status escalation guard covering INSERT as well as UPDATE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_membership_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Trusted/system paths (service role, migrations, direct SQL) carry no JWT
  -- subject. They already bypass RLS and are intentionally not constrained
  -- here; restricting them would break onboarding and background jobs.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- M3-002: INSERT path. Granting 'owner' is an escalation and must require
  -- that the caller is already an owner of that same business.
  --
  -- This must be a complete early return. On INSERT, OLD is an unassigned
  -- record, so falling through to the UPDATE branch below would evaluate
  -- `OLD.role IS DISTINCT FROM NEW.role` as true for every row and block
  -- admins from adding ordinary members entirely (over-blocking regression,
  -- caught by red-team positive control).
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'owner'
       AND NEW.business_id NOT IN (SELECT public.auth_user_owner_businesses()) THEN
      RAISE EXCEPTION
        'privilege escalation blocked: granting role owner requires owner role in business %',
        NEW.business_id;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE path: any change to role or status requires owner.
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status)
     AND NEW.business_id NOT IN (SELECT public.auth_user_owner_businesses()) THEN
    RAISE EXCEPTION 'privilege escalation blocked: role/status changes require owner role';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_membership_role_escalation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_membership_role_escalation() FROM anon, authenticated;

-- Recreate the trigger so it is present for BOTH operations. DROP first
-- because CREATE OR REPLACE TRIGGER is not available in all supported
-- PostgreSQL versions.
DROP TRIGGER IF EXISTS trg_business_members_role_escalation ON public.business_members;
CREATE TRIGGER trg_business_members_role_escalation
  BEFORE INSERT OR UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_membership_role_escalation();

-- ============================================================================
-- 3. The business_id immutability trigger has the same generic-trigger shape
--    risk in principle (it references only NEW.business_id), but it is attached
--    exclusively to tables that all carry business_id. Add a guard so a future
--    attachment to a table without the column fails loudly at migration time
--    rather than silently at runtime.
-- ============================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'business_members','suppliers','customers','products',
    'transactions','expenses','inventory_movements','receivables','payables',
    'supplier_pricing','documents','ingestion_jobs','document_extractions',
    'document_embeddings','profit_leaks','cash_flow_forecasts','scenarios',
    'actions','chat_sessions','notifications','audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'business_id'
    ) THEN
      RAISE EXCEPTION 'cannot attach prevent_business_id_mutation to public.%: no business_id column', t;
    END IF;
  END LOOP;
END $$;