-- Child rows inherit the parent's write permission, not merely its visibility.
DO $$
DECLARE operation text; predicate text;
BEGIN
  predicate := 'EXISTS (SELECT 1 FROM public.transactions t JOIN public.business_members m ON m.business_id = t.business_id
    WHERE t.id = transaction_items.transaction_id AND m.user_id = (SELECT auth.uid())
    AND m.status = ''active'' AND m.role IN (''owner'',''admin'',''manager'',''accountant''))';
  FOREACH operation IN ARRAY ARRAY['insert','update','delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.transaction_items','transaction_items_tenant_'||operation);
    EXECUTE format('CREATE POLICY %I ON public.transaction_items FOR %s TO authenticated %s',
      'transaction_items_tenant_'||operation,upper(operation),CASE WHEN operation = 'insert' THEN 'WITH CHECK ('||predicate||')'
        WHEN operation = 'update' THEN 'USING ('||predicate||') WITH CHECK ('||predicate||')' ELSE 'USING ('||predicate||')' END);
  END LOOP;
END $$;

-- Narrow metadata-only recovery operation; it cannot alter financial review or source identity.
CREATE OR REPLACE FUNCTION public.record_document_index(p_business_id uuid,p_document_id uuid,p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE chunks integer;
BEGIN
  PERFORM public.require_document_writer(p_business_id);
  IF p_status IS NULL OR p_status NOT IN ('indexed','insufficient_evidence','failed') THEN
    RAISE EXCEPTION 'Invalid index status' USING ERRCODE = '22023';
  END IF;
  SELECT count(*)::integer INTO chunks FROM public.document_embeddings
    WHERE business_id = p_business_id AND document_id = p_document_id AND embedding IS NOT NULL;
  IF p_status = 'indexed' AND chunks = 0 THEN RAISE EXCEPTION 'No durable embeddings' USING ERRCODE = '23514'; END IF;
  UPDATE public.documents SET rag_indexing_status=p_status,rag_chunk_count=chunks,
    rag_indexing_error=CASE WHEN p_status='failed' THEN 'Context indexing failed; extraction remains saved. Retry indexing before relying on retrieval.' ELSE NULL END
  WHERE business_id=p_business_id AND id=p_document_id AND status IN ('extracted','review_required','approved');
  IF NOT FOUND THEN RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_document_index(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_document_index(uuid,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
