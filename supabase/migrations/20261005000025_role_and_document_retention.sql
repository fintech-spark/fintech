-- Direct Data API access must enforce the same operational write roles as HTTP.
-- Source records cannot be detached by deleting their metadata.
REVOKE DELETE ON public.documents FROM anon, authenticated;
DO $$
DECLARE t text; roles text[]; predicate text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers','customers','transactions','expenses','receivables','payables','supplier_pricing',
    'products','inventory_movements','documents','ingestion_jobs','document_extractions','document_embeddings'] LOOP
    roles := CASE WHEN t IN ('suppliers','customers','transactions','expenses','receivables','payables','supplier_pricing')
      THEN ARRAY['owner','admin','manager','accountant'] ELSE ARRAY['owner','admin','manager'] END;
    predicate := format('EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id = %I.business_id AND m.user_id = (SELECT auth.uid()) AND m.status = ''active'' AND m.role = ANY(%L::text[]))',t,roles);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_tenant_insert',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_tenant_update',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',t||'_tenant_delete',t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (%s)',t||'_tenant_insert',t,predicate);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',t||'_tenant_update',t,predicate,predicate);
    IF t <> 'documents' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (%s)',t||'_tenant_delete',t,predicate);
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
