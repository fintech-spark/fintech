-- Merchant Brain: Database Security — Tenant Isolation via Row Level Security
-- Migration 0004: RLS enablement, policies, SECURITY DEFINER helpers,
-- ownership-mutation triggers, and hardening of existing utility functions.
--
-- Identity model: Supabase Auth users. public.users.id mirrors auth.users.id
-- (the application user profile is keyed by the same uuid as the auth subject).
-- Authorization is resolved as: auth.uid() -> public.business_members -> businesses.
-- Never trust client-provided business_id without re-checking membership.

-- ============================================================================
-- 1. Harden existing utility functions: pin search_path, qualify extensions
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.gen_uuid()
RETURNS uuid
LANGUAGE sql
SET search_path = ''
AS $$
  SELECT extensions.gen_random_uuid();
$$;

-- ============================================================================
-- 2. SECURITY DEFINER membership helpers
--
-- These bypass RLS on public.business_members (as the function owner) to
-- resolve the *current* user's memberships without triggering recursive RLS
-- evaluation on business_members itself. They are STABLE, return only the
-- caller's own memberships, and cannot accept a user id parameter — the
-- subject always comes from auth.uid(). They must remain SECURITY DEFINER:
-- documented reason above. search_path is pinned to empty so the function
-- body cannot be hijacked by schema-shadowing objects.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.auth_user_businesses()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT bm.business_id
  FROM public.business_members AS bm
  WHERE bm.user_id = auth.uid()
    AND bm.status = 'active';
$$;

CREATE OR REPLACE FUNCTION public.auth_user_admin_businesses()
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
    AND bm.role IN ('owner', 'admin');
$$;

REVOKE ALL ON FUNCTION public.auth_user_businesses() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_admin_businesses() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_user_businesses() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.auth_user_admin_businesses() TO authenticated, anon;

-- ============================================================================
-- 3. Ownership-mutation prevention triggers
--
-- A tenant root column (business_id) or ownership parent FK must never be
-- re-pointed by an UPDATE. These triggers fail closed, including when the
-- actor is a member of both businesses.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.prevent_business_id_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id THEN
    RAISE EXCEPTION 'tenant boundary violation: business_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_parent_id_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_ARGV[0] = 'transaction_id' AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
    RAISE EXCEPTION 'ownership violation: transaction_id is immutable';
  END IF;
  IF TG_ARGV[0] = 'action_id' AND NEW.action_id IS DISTINCT FROM OLD.action_id THEN
    RAISE EXCEPTION 'ownership violation: action_id is immutable';
  END IF;
  IF TG_ARGV[0] = 'session_id' AND NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    RAISE EXCEPTION 'ownership violation: session_id is immutable';
  END IF;
  IF TG_ARGV[0] = 'supplier_id' AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
    RAISE EXCEPTION 'ownership violation: supplier_id is immutable';
  END IF;
  IF TG_ARGV[0] = 'customer_id' AND NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION 'ownership violation: customer_id is immutable';
  END IF;
  IF TG_ARGV[0] = 'user_id' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'ownership violation: user_id is immutable';
  END IF;
  IF TG_ARGV[0] = 'id' AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'ownership violation: id is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- Attach business_id immutability to every tenant table that carries it.
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
    EXECUTE format(
      'CREATE TRIGGER trg_%I_business_id_imm BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.prevent_business_id_mutation()', t, t);
  END LOOP;
END $$;

-- business_members must also keep business_id and user_id frozen (both covered:
-- business_id by the trigger above, user_id below).
CREATE TRIGGER trg_business_members_user_id_imm BEFORE UPDATE ON public.business_members
  FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_id_mutation('user_id');

CREATE TRIGGER trg_transaction_items_parent_imm BEFORE UPDATE ON public.transaction_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_id_mutation('transaction_id');
CREATE TRIGGER trg_action_logs_parent_imm BEFORE UPDATE ON public.action_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_id_mutation('action_id');
CREATE TRIGGER trg_chat_messages_parent_imm BEFORE UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_id_mutation('session_id');
CREATE TRIGGER trg_notifications_user_id_imm BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_id_mutation('user_id');
CREATE TRIGGER trg_chat_sessions_user_id_imm BEFORE UPDATE ON public.chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_id_mutation('user_id');
CREATE TRIGGER trg_users_id_imm BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_parent_id_mutation('id');

-- ============================================================================
-- 4. Enable RLS on every tenant-sensitive table (force it too)
-- ============================================================================
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
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- ============================================================================
-- 5. Policies — users (profile keyed to auth subject)
-- ============================================================================
CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY users_insert_own ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- No DELETE policy: user deletion is denied at the DB layer.

-- ============================================================================
-- 6. Policies — businesses
-- ============================================================================
CREATE POLICY businesses_select_member ON public.businesses
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.auth_user_businesses()));

CREATE POLICY businesses_insert_authenticated ON public.businesses
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY businesses_update_admin ON public.businesses
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.auth_user_admin_businesses()))
  WITH CHECK (id IN (SELECT public.auth_user_admin_businesses()));

CREATE POLICY businesses_delete_admin ON public.businesses
  FOR DELETE TO authenticated
  USING (id IN (SELECT public.auth_user_admin_businesses()));

-- ============================================================================
-- 7. Policies — business_members
-- ============================================================================
CREATE POLICY business_members_select_self_or_same_biz ON public.business_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR business_id IN (SELECT public.auth_user_businesses()));

CREATE POLICY business_members_insert_admin ON public.business_members
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT public.auth_user_admin_businesses()));

CREATE POLICY business_members_update_admin ON public.business_members
  FOR UPDATE TO authenticated
  USING (business_id IN (SELECT public.auth_user_admin_businesses()))
  WITH CHECK (business_id IN (SELECT public.auth_user_admin_businesses()));

CREATE POLICY business_members_delete_admin ON public.business_members
  FOR DELETE TO authenticated
  USING (business_id IN (SELECT public.auth_user_admin_businesses()));

-- ============================================================================
-- 8. Policies — plain tenant tables (direct business_id)
--    SELECT/INSERT/UPDATE/DELETE all require active membership in that tenant.
-- ============================================================================
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'suppliers','customers','products','transactions','expenses',
    'inventory_movements','receivables','payables','supplier_pricing',
    'documents','ingestion_jobs','document_extractions','document_embeddings',
    'profit_leaks','cash_flow_forecasts','scenarios','actions','audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format(
      'CREATE POLICY %I_tenant_select ON public.%I FOR SELECT TO authenticated
       USING (business_id IN (SELECT public.auth_user_businesses()))', t, t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_insert ON public.%I FOR INSERT TO authenticated
       WITH CHECK (business_id IN (SELECT public.auth_user_businesses()))', t, t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_update ON public.%I FOR UPDATE TO authenticated
       USING (business_id IN (SELECT public.auth_user_businesses()))
       WITH CHECK (business_id IN (SELECT public.auth_user_businesses()))', t, t);
    EXECUTE format(
      'CREATE POLICY %I_tenant_delete ON public.%I FOR DELETE TO authenticated
       USING (business_id IN (SELECT public.auth_user_businesses()))', t, t);
    END LOOP;
END $$;

-- ============================================================================
-- 9. Policies — child tables with indirect tenancy
-- ============================================================================

-- transaction_items -> transactions.business_id
CREATE POLICY transaction_items_tenant_select ON public.transaction_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = transaction_items.transaction_id
      AND t.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY transaction_items_tenant_insert ON public.transaction_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = transaction_items.transaction_id
      AND t.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY transaction_items_tenant_update ON public.transaction_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = transaction_items.transaction_id
      AND t.business_id IN (SELECT public.auth_user_businesses())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = transaction_items.transaction_id
      AND t.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY transaction_items_tenant_delete ON public.transaction_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = transaction_items.transaction_id
      AND t.business_id IN (SELECT public.auth_user_businesses())
  ));

-- action_logs -> actions.business_id
CREATE POLICY action_logs_tenant_select ON public.action_logs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.actions a
    WHERE a.id = action_logs.action_id
      AND a.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY action_logs_tenant_insert ON public.action_logs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.actions a
    WHERE a.id = action_logs.action_id
      AND a.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY action_logs_tenant_update ON public.action_logs
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.actions a
    WHERE a.id = action_logs.action_id
      AND a.business_id IN (SELECT public.auth_user_businesses())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.actions a
    WHERE a.id = action_logs.action_id
      AND a.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY action_logs_tenant_delete ON public.action_logs
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.actions a
    WHERE a.id = action_logs.action_id
      AND a.business_id IN (SELECT public.auth_user_businesses())
  ));

-- chat_sessions: direct business_id, but a session belongs to its owner user
CREATE POLICY chat_sessions_select_own ON public.chat_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()));
CREATE POLICY chat_sessions_insert_own ON public.chat_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()));
CREATE POLICY chat_sessions_update_own ON public.chat_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()))
  WITH CHECK (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()));
CREATE POLICY chat_sessions_delete_own ON public.chat_sessions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()));

-- chat_messages -> chat_sessions (owner user AND business membership)
CREATE POLICY chat_messages_tenant_select ON public.chat_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chat_sessions s
    WHERE s.id = chat_messages.session_id
      AND s.user_id = auth.uid()
      AND s.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY chat_messages_tenant_insert ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.chat_sessions s
    WHERE s.id = chat_messages.session_id
      AND s.user_id = auth.uid()
      AND s.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY chat_messages_tenant_update ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chat_sessions s
    WHERE s.id = chat_messages.session_id
      AND s.user_id = auth.uid()
      AND s.business_id IN (SELECT public.auth_user_businesses())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.chat_sessions s
    WHERE s.id = chat_messages.session_id
      AND s.user_id = auth.uid()
      AND s.business_id IN (SELECT public.auth_user_businesses())
  ));
CREATE POLICY chat_messages_tenant_delete ON public.chat_messages
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chat_sessions s
    WHERE s.id = chat_messages.session_id
      AND s.user_id = auth.uid()
      AND s.business_id IN (SELECT public.auth_user_businesses())
  ));

-- notifications: recipients only
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()));
CREATE POLICY notifications_insert_member ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (business_id IN (SELECT public.auth_user_businesses()));
CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()))
  WITH CHECK (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()));
CREATE POLICY notifications_delete_own ON public.notifications
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND business_id IN (SELECT public.auth_user_businesses()));

-- ============================================================================
-- 10. Deny-by-default is complete: every table has RLS forced and no
--     USING (true) policy exists on tenant data. policies above are the only
--     ones; without a matching policy a statement is denied.
-- ============================================================================
