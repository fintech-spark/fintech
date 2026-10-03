-- Merchant Brain: Database Security — Phase 2 audit adjustments
-- Migration 0006: tighten audit_logs to append-only for application roles,
-- revoke _migrations from API roles, protect role/status escalation and
-- mutable-trust fields (users.email).

-- ============================================================================
-- 1. audit_logs: members may read, but authenticated users can never write
-- ============================================================================
DROP POLICY IF EXISTS audit_logs_tenant_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_tenant_update ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_tenant_delete ON public.audit_logs;
-- (SELECT policy from 0004 remains: audit_logs_tenant_select)

-- ============================================================================
-- 2. _migrations: no API-role access
-- ============================================================================
REVOKE ALL ON public._migrations FROM anon, authenticated;

-- ============================================================================
-- 3. business_members role/status escalation guard
--
-- Any UPDATE that changes role or status must be performed by a caller whose
-- OWN role in that business is 'owner'. Prevents an admin (or a rogue
-- self-edit) from promoting to owner, and prevents silent deactivation that
-- a mere admin should not be able to sneak past the intended lifecycle.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auth_user_owner_businesses()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT bm.business_id
  FROM public.business_members AS bm
  WHERE bm.user_id = auth.uid()
    AND bm.status = 'active'
    AND bm.role = 'owner';
$$;

REVOKE ALL ON FUNCTION public.auth_user_owner_businesses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_owner_businesses() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.prevent_membership_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Trusted/system paths (service role, direct SQL) have no JWT subject;
  -- they bypass RLS and must not be blocked by this trigger.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status)
     AND NEW.business_id NOT IN (SELECT public.auth_user_owner_businesses()) THEN
    RAISE EXCEPTION 'privilege escalation blocked: role/status changes require owner role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_business_members_role_escalation
  BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_membership_role_escalation();

-- ============================================================================
-- 4. users.email is a trust anchor — it cannot be changed via UPDATE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_users_email_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'ownership violation: users.email is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_email_imm BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_users_email_mutation();
