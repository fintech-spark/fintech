-- Registered source identity cannot be detached to bypass private storage retention.
CREATE OR REPLACE FUNCTION public.guard_document_source_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.storage_path IS DISTINCT FROM NEW.storage_path
    OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
    OR OLD.file_size IS DISTINCT FROM NEW.file_size
    OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
    OR OLD.file_name IS DISTINCT FROM NEW.file_name
    OR OLD.source_type IS DISTINCT FROM NEW.source_type THEN
    RAISE EXCEPTION 'Registered document source is immutable' USING ERRCODE = '42501';
  END IF;
  IF current_user IN ('authenticated','anon') AND
    (OLD.status = 'approved' OR OLD.promoted_resource_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Reviewed promotion provenance is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_document_source_identity ON public.documents;
CREATE TRIGGER trg_document_source_identity BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_source_identity();
NOTIFY pgrst, 'reload schema';
