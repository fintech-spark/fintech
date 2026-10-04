-- Merchant Brain: Migration 0012 — audit-trail immutability and RAG search_path
--
-- Two security defects closed here. Both were found by reviewing the applied
-- migrations against the code that depends on them, not by a failing test.
--
-- ---------------------------------------------------------------------------
-- 1. `action_logs` was mutable, and its new tenant column was unguarded
-- ---------------------------------------------------------------------------
-- Migration 0004 granted `action_logs_tenant_update` and `action_logs_tenant_delete`
-- to any active member of the parent action's tenant. At that time the table had
-- no `business_id` of its own, so an UPDATE could not move a row between tenants —
-- but it could still rewrite or delete history.
--
-- Migration 0011 then added `action_logs.business_id` (backfilled from the parent
-- action) WITHOUT:
--   * extending the immutability trigger list from 0004 (which omits action_logs),
--   * adding any policy that validates the new column against the parent action.
--
-- Combined, that let a member of tenant A relabel audit rows to tenant B, rewrite
-- their contents, or delete them outright — while 0011's own comment states the
-- table is "never updated, never deleted". An audit trail that any tenant member
-- can edit is not an audit trail.
--
-- Fix:
--   * DROP the UPDATE and DELETE policies. Append-only is enforced by policy; the
--     service layer already only ever inserts (see modules/actions).
--   * Add `trg_action_logs_business_id_imm` so the tenant column is frozen, in the
--     same shape as the 0004 trigger.
--   * Add an INSERT policy that requires the supplied `business_id` to match the
--     parent action's tenant, so a row cannot be born into the wrong tenant.
--
-- SELECT is intentionally left as-is (0004: parent-join membership check); it is
-- read-only and correctly scoped.
--
-- ---------------------------------------------------------------------------
-- 2. `match_document_embeddings` ran with a widened search_path
-- ---------------------------------------------------------------------------
-- Every other SECURITY DEFINER function in this schema pins `search_path = ''`.
-- 0010 pinned this one to `public, extensions` because the body uses the `<=>`
-- cosine-distance operator, which lives in the `extensions` schema on Supabase.
--
-- Pinning to '' breaks the unqualified operator, but PostgreSQL lets an operator be
-- schema-qualified inline, so the correct fix is to qualify it and restore the pin.
-- Leaving it widened means the definer resolves unqualified names against a schema
-- that authenticated roles can create objects in, and `pg_temp` is searched first.
--
-- Fix: recreate the function with `SET search_path = ''` and `OPERATOR(extensions.<=>)`.
--
-- ---------------------------------------------------------------------------
-- Re-runnable: every statement is guarded (DROP ... IF EXISTS / CREATE OR REPLACE).
-- Verified by: tests/database-security.test.ts, tests/database-schema.test.ts
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. action_logs: append-only, with a tenant column that cannot drift
-- ===========================================================================

DROP POLICY IF EXISTS action_logs_tenant_update ON public.action_logs;
DROP POLICY IF EXISTS action_logs_tenant_delete ON public.action_logs;

-- The parent-join policies from 0004 remain for SELECT and INSERT. Replace the
-- INSERT policy with one that also pins the denormalised tenant column, so a row
-- cannot be inserted claiming a tenant its parent action does not belong to.
DROP POLICY IF EXISTS action_logs_tenant_insert ON public.action_logs;

CREATE POLICY action_logs_tenant_insert ON public.action_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id IN (SELECT public.auth_user_businesses())
    AND EXISTS (
      SELECT 1 FROM public.actions a
      WHERE a.id = action_logs.action_id
        AND a.business_id = action_logs.business_id
        AND a.business_id IN (SELECT public.auth_user_businesses())
    )
  );

-- Freeze the tenant column, exactly as 0004 does for the other 20 tenant tables.
-- `action_logs` was missing from that list because it had no business_id yet.
DROP TRIGGER IF EXISTS trg_action_logs_business_id_imm ON public.action_logs;

CREATE TRIGGER trg_action_logs_business_id_imm
  BEFORE UPDATE ON public.action_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_business_id_mutation();

-- Belt and braces: assert the invariants this migration establishes, so a future
-- migration that re-adds a mutating policy fails loudly instead of silently
-- reopening the hole. Same assertion-gate style as 0009.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'action_logs'
      AND policyname IN ('action_logs_tenant_update', 'action_logs_tenant_delete')
  ) THEN
    RAISE EXCEPTION
      'audit invariant violated: action_logs must not have UPDATE or DELETE policies';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.action_logs'::regclass
      AND tgname = 'trg_action_logs_business_id_imm'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION
      'audit invariant violated: action_logs.business_id immutability trigger is missing';
  END IF;
END $$;

-- ===========================================================================
-- 2. match_document_embeddings: restore the pinned search_path
-- ===========================================================================
-- Body is otherwise identical to 0010. Only the operator qualification and the
-- search_path pin change.
--
-- WHY THE OPERATOR SCHEMA IS DISCOVERED, NOT HARDCODED
-- -----------------------------------------------------
-- Pinning search_path to '' requires the cosine-distance operator to be written
-- schema-qualified. But the schema it lives in is not the same on every install:
-- hosted Supabase creates the `vector` extension into `extensions`, while a local
-- stack may install it into `public`. Hardcoding either one produces a migration
-- that applies in development and fails in production, or the reverse.
--
-- So the schema is read from the catalog: find the schema owning
-- `document_embeddings.embedding`'s type, then the `<=>` operator in that same
-- schema. The function is then built with format(). If neither is found the
-- migration raises rather than silently producing a broken function.

DO $$
DECLARE
  v_type_schema text;
  v_op_schema   text;
  v_op          text;
BEGIN
  SELECT tn.nspname
    INTO v_type_schema
  FROM pg_attribute a
  JOIN pg_type t      ON t.oid = a.atttypid
  JOIN pg_namespace tn ON tn.oid = t.typnamespace
  WHERE a.attrelid = 'public.document_embeddings'::regclass
    AND a.attname   = 'embedding'
    AND NOT a.attisdropped;

  IF v_type_schema IS NULL THEN
    RAISE EXCEPTION
      'cannot determine the schema of document_embeddings.embedding; is the vector extension installed?';
  END IF;

  SELECT n.nspname
    INTO v_op_schema
  FROM pg_operator o
  JOIN pg_namespace n ON n.oid = o.oprnamespace
  WHERE o.oprname = '<=>'
    AND n.nspname = v_type_schema
  LIMIT 1;

  IF v_op_schema IS NULL THEN
    RAISE EXCEPTION
      'cannot locate the vector cosine-distance operator in schema %; is pgvector installed?', v_type_schema;
  END IF;

  v_op := format('OPERATOR(%I.<=>)', v_op_schema);

  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION public.match_document_embeddings(
      p_business_id     uuid,
      p_query_embedding vector(1536),
      p_match_count     integer DEFAULT 5,
      p_match_threshold real    DEFAULT 0.35,
      p_source_types    text[]  DEFAULT NULL
    )
    RETURNS TABLE (
      chunk_id       uuid,
      document_id    uuid,
      content        text,
      metadata       jsonb,
      similarity     real,
      source_type    text,
      file_name      text,
      uploaded_at    timestamptz,
      chunk_index    integer,
      created_at     timestamptz
    )
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $fn$
      SELECT
        e.id,
        e.document_id,
        e.content,
        e.metadata,
        (1 - (e.embedding %1$s p_query_embedding))::real AS similarity,
        d.source_type,
        d.file_name,
        d.uploaded_at,
        e.chunk_index,
        e.created_at
      FROM public.document_embeddings e
      JOIN public.documents d
        ON d.id = e.document_id
       AND d.business_id = e.business_id
      WHERE e.business_id = p_business_id
        AND e.business_id IN (SELECT public.auth_user_businesses())
        AND e.embedding IS NOT NULL
        AND p_query_embedding IS NOT NULL
        AND (1 - (e.embedding %1$s p_query_embedding)) >= p_match_threshold
        AND (p_source_types IS NULL OR e.metadata->>'sourceType' = ANY (p_source_types))
      ORDER BY e.embedding %1$s p_query_embedding
      LIMIT LEAST(GREATEST(COALESCE(p_match_count, 5), 1), 50);
    $fn$;
  $ddl$, v_op);

  RAISE NOTICE 'match_document_embeddings recreated with search_path pinned; operator resolved from schema %', v_op_schema;
END $$;

REVOKE ALL ON FUNCTION public.match_document_embeddings(uuid, vector, integer, real, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_document_embeddings(uuid, vector, integer, real, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_document_embeddings(uuid, vector, integer, real, text[]) TO authenticated;
