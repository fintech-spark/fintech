-- Parent tenant consistency also applies to privileged raw PG writers, where
-- RLS is bypassed. A scoped child cannot reference another tenant's parent.
-- NOT VALID preserves historical rows; new inserts/updates are checked. Audit
-- historical inconsistencies separately before validating on an existing DB.
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_business_id_id
  ON public.documents (business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_business_id_id
  ON public.actions (business_id, id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.document_embeddings'::regclass
      AND conname = 'fk_embeddings_tenant_document'
  ) THEN
    ALTER TABLE public.document_embeddings
      ADD CONSTRAINT fk_embeddings_tenant_document
      FOREIGN KEY (business_id, document_id)
      REFERENCES public.documents (business_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.action_logs'::regclass
      AND conname = 'fk_action_logs_tenant_action'
  ) THEN
    ALTER TABLE public.action_logs
      ADD CONSTRAINT fk_action_logs_tenant_action
      FOREIGN KEY (business_id, action_id)
      REFERENCES public.actions (business_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END;
$$;
