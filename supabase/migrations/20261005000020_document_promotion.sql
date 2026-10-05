-- Production document lifecycle. Invoked with the caller JWT, never a user-id argument.
ALTER TABLE public.document_extractions ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.require_document_writer(p_business_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.business_members m WHERE m.business_id = p_business_id
    AND m.user_id = auth.uid() AND m.status = 'active' AND m.role IN ('owner','admin','manager')
  ) THEN RAISE EXCEPTION 'Document access denied' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.require_document_writer(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_document_extraction(p_business_id uuid, p_document_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claimed uuid;
BEGIN
  PERFORM public.require_document_writer(p_business_id);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text,0));
  IF (SELECT count(*) FROM public.ingestion_jobs WHERE business_id = p_business_id
    AND started_at > now() - interval '1 minute') >= 20 THEN
    RAISE EXCEPTION 'Extraction quota exceeded' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.documents SET status = 'processing', rejection_reason = NULL, updated_at = now()
  WHERE business_id = p_business_id AND id = p_document_id AND content_hash IS NOT NULL
  AND (status IN ('queued','failed') OR (status = 'processing' AND updated_at < now() - interval '5 minutes'))
  RETURNING id INTO claimed;
  IF claimed IS NOT NULL THEN
    INSERT INTO public.ingestion_jobs (business_id,document_id,state,source_type,created_by)
      SELECT p_business_id,id,'extracting',source_type,auth.uid() FROM public.documents
      WHERE business_id = p_business_id AND id = claimed;
  END IF;
  RETURN claimed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_document_extraction(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_document_extraction(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.persist_document_extraction(p_business_id uuid, p_document_id uuid, p_candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.documents; e public.document_extractions;
BEGIN
  PERFORM public.require_document_writer(p_business_id);
  SELECT * INTO d FROM public.documents WHERE business_id = p_business_id AND id = p_document_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002'; END IF;
  IF d.status <> 'processing' THEN RAISE EXCEPTION 'Document is not processing' USING ERRCODE = '23514'; END IF;
  IF jsonb_typeof(p_candidate->'fields') <> 'array' OR jsonb_typeof(p_candidate->'evidence') <> 'array'
    OR p_candidate->>'overall_confidence' NOT IN ('high','medium','low')
    OR NULLIF(p_candidate->>'model_used','') IS NULL THEN
    RAISE EXCEPTION 'Invalid candidate' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO e FROM public.document_extractions WHERE business_id = p_business_id AND document_id = p_document_id
    AND status IN ('completed','validated') ORDER BY extracted_at DESC LIMIT 1;
  IF e.id IS NULL THEN
    INSERT INTO public.document_extractions (id,business_id,document_id,status,fields,evidence,overall_confidence,model_used,raw_output)
    VALUES ((p_candidate->>'id')::uuid,p_business_id,p_document_id,'completed',p_candidate->'fields',p_candidate->'evidence',
      p_candidate->>'overall_confidence',p_candidate->>'model_used',p_candidate->>'raw_output') RETURNING * INTO e;
  END IF;
  UPDATE public.documents SET extraction_id = e.id::text WHERE business_id = p_business_id AND id = p_document_id;
  RETURN to_jsonb(e);
END;
$$;
REVOKE ALL ON FUNCTION public.persist_document_extraction(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_document_extraction(uuid,uuid,jsonb) TO authenticated;

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_values jsonb;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS promoted_resource_type text CHECK (promoted_resource_type IN ('transaction','expense'));
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS promoted_resource_id uuid;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_document_once ON public.transactions (business_id,source_document_id) WHERE source_document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS expenses_document_once ON public.expenses (business_id,source_document_id) WHERE source_document_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.review_minor(p_value jsonb)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v numeric;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Integer minor-unit value required' USING ERRCODE = '22023';
  END IF;
  v := p_value::text::numeric;
  IF v < 0 OR v > 1000000000000 OR v <> trunc(v) THEN
    RAISE EXCEPTION 'Invalid minor-unit value' USING ERRCODE = '22023';
  END IF;
  RETURN v::bigint;
END;
$$;
REVOKE ALL ON FUNCTION public.review_minor(jsonb) FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER is required only because audit_logs deliberately has no user INSERT policy.
-- The caller, membership, role, source and every financial value are checked again here.
CREATE OR REPLACE FUNCTION public.promote_reviewed_document(p_business_id uuid, p_document_id uuid, p_review jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d public.documents; e public.document_extractions; line jsonb; key text;
  kind text; ref text; vendor text; direction text; cp uuid; occurred date; ledger_id uuid;
  amount bigint; subtotal bigint := 0; discount bigint := 0; tax bigint := 0; total bigint := 0;
  qty bigint; unit bigint; line_discount bigint; line_tax bigint; line_total bigint;
BEGIN
  PERFORM public.require_document_writer(p_business_id);
  -- Serialize duplicate checks only within this business; separate businesses remain independent.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text,0));
  SELECT * INTO d FROM public.documents WHERE business_id = p_business_id AND id = p_document_id FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Document not found' USING ERRCODE = 'P0002'; END IF;
  IF d.status = 'approved' AND d.promoted_resource_id IS NOT NULL THEN
    IF d.reviewed_values IS DISTINCT FROM p_review THEN
      RAISE EXCEPTION 'Different review already promoted' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('resourceType',d.promoted_resource_type,'resourceId',d.promoted_resource_id,'replayed',true);
  END IF;
  IF d.status NOT IN ('extracted','review_required') OR d.content_hash IS NULL THEN
    RAISE EXCEPTION 'Verified extraction must be reviewed before promotion' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO e FROM public.document_extractions WHERE business_id = p_business_id AND document_id = p_document_id
    AND id::text = d.extraction_id AND id::text = p_review->>'extractionId' AND status = 'completed' FOR UPDATE;
  IF e.id IS NULL THEN RAISE EXCEPTION 'Current candidate not found' USING ERRCODE = 'P0002'; END IF;
  IF jsonb_typeof(p_review) IS DISTINCT FROM 'object' OR p_review->'reviewed' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'Explicit merchant review required' USING ERRCODE = '22023';
  END IF;
  kind := p_review->>'kind';
  IF kind IS NULL OR kind NOT IN ('invoice','expense') OR (kind = 'invoice' AND d.source_type <> 'invoice')
    OR (kind = 'expense' AND d.source_type <> 'receipt') THEN
    RAISE EXCEPTION 'Unsupported document family' USING ERRCODE = '22023';
  END IF;
  FOR key IN SELECT jsonb_object_keys(p_review) LOOP
    IF key <> ALL (CASE WHEN kind = 'invoice' THEN
      ARRAY['kind','reviewed','extractionId','date','reference','currency','direction','counterpartyId','items','totalMinor']
      ELSE ARRAY['kind','reviewed','extractionId','date','reference','currency','category','description','vendor','amountMinor'] END) THEN
      RAISE EXCEPTION 'Unknown review field' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOREACH key IN ARRAY ARRAY['date','reference','currency'] LOOP
    IF jsonb_typeof(p_review->key) IS DISTINCT FROM 'string' OR length(btrim(p_review->>key)) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Required reviewed field missing' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_review->>'currency' NOT IN ('INR','USD','EUR','GBP') OR p_review->>'date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'Invalid currency or calendar date' USING ERRCODE = '22023';
  END IF;
  occurred := (p_review->>'date')::date;
  ref := btrim(p_review->>'reference');
  IF EXISTS (SELECT 1 FROM public.documents WHERE business_id = p_business_id AND id <> p_document_id
    AND status = 'approved' AND content_hash = d.content_hash) THEN
    RAISE EXCEPTION 'Identical file already promoted' USING ERRCODE = '23505';
  END IF;
  ledger_id := pg_catalog.gen_random_uuid();
  IF kind = 'expense' THEN
    FOREACH key IN ARRAY ARRAY['category','description','vendor'] LOOP
      IF jsonb_typeof(p_review->key) IS DISTINCT FROM 'string' OR length(btrim(p_review->>key)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Expense reviewed values required' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF p_review->>'category' NOT IN ('rent','utilities','salaries','supplies','marketing','transportation','insurance','maintenance','taxes','fees','other') THEN
      RAISE EXCEPTION 'Invalid category' USING ERRCODE = '22023';
    END IF;
    amount := public.review_minor(p_review->'amountMinor');
    IF amount = 0 THEN RAISE EXCEPTION 'Positive expense required' USING ERRCODE = '22023'; END IF;
    vendor := btrim(p_review->>'vendor');
    IF EXISTS (SELECT 1 FROM public.expenses ex WHERE ex.business_id = p_business_id AND lower(btrim(ex.reference)) = lower(ref)
      AND lower(btrim(ex.vendor)) = lower(btrim(p_review->>'vendor')) AND ex.status <> 'rejected') THEN
      RAISE EXCEPTION 'Expense reference already recorded' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.expenses (id,business_id,category,amount_minor,currency,description,vendor,reference,status,expense_date,
      idempotency_key,created_by,source_document_id)
    VALUES (ledger_id,p_business_id,p_review->>'category',amount,p_review->>'currency',btrim(p_review->>'description'),vendor,ref,
      'approved',occurred,'document:'||p_document_id::text,auth.uid(),p_document_id);
  ELSE
    direction := p_review->>'direction';
    IF direction IS NULL OR direction NOT IN ('sale','purchase') OR jsonb_typeof(p_review->'counterpartyId') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Invoice direction and counterparty required' USING ERRCODE = '22023';
    END IF;
    cp := (p_review->>'counterpartyId')::uuid;
    IF (direction = 'sale' AND NOT EXISTS (SELECT 1 FROM public.customers WHERE business_id = p_business_id AND id = cp))
      OR (direction = 'purchase' AND NOT EXISTS (SELECT 1 FROM public.suppliers WHERE business_id = p_business_id AND id = cp)) THEN
      RAISE EXCEPTION 'Counterparty not found' USING ERRCODE = 'P0002';
    END IF;
    IF jsonb_typeof(p_review->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_review->'items') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Reviewed invoice lines required' USING ERRCODE = '22023';
    END IF;
    FOR line IN SELECT value FROM jsonb_array_elements(p_review->'items') LOOP
      IF jsonb_typeof(line) IS DISTINCT FROM 'object' OR jsonb_typeof(line->'description') IS DISTINCT FROM 'string'
        OR length(btrim(line->>'description')) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'Invalid invoice description' USING ERRCODE = '22023';
      END IF;
      FOR key IN SELECT jsonb_object_keys(line) LOOP
        IF key <> ALL (ARRAY['description','quantity','unitPriceMinor','discountMinor','taxMinor','totalMinor']) THEN
          RAISE EXCEPTION 'Unknown line field' USING ERRCODE = '22023';
        END IF;
      END LOOP;
      qty := public.review_minor(line->'quantity'); unit := public.review_minor(line->'unitPriceMinor');
      line_discount := public.review_minor(line->'discountMinor'); line_tax := public.review_minor(line->'taxMinor');
      line_total := public.review_minor(line->'totalMinor');
      IF qty NOT BETWEEN 1 AND 1000000 OR qty::numeric * unit > 1000000000000 OR line_discount > qty * unit
        OR line_total <> qty * unit - line_discount + line_tax THEN
        RAISE EXCEPTION 'Invoice line arithmetic mismatch' USING ERRCODE = '22023';
      END IF;
      subtotal := subtotal + qty * unit; discount := discount + line_discount; tax := tax + line_tax; total := total + line_total;
    END LOOP;
    IF total = 0 OR total <> public.review_minor(p_review->'totalMinor') OR greatest(subtotal,discount,tax,total) > 1000000000000 THEN
      RAISE EXCEPTION 'Invoice total mismatch' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE business_id = p_business_id AND type = direction
      AND counterparty_id = cp::text AND lower(btrim(reference)) = lower(ref) AND status <> 'voided') THEN
      RAISE EXCEPTION 'Invoice reference already recorded' USING ERRCODE = '23505';
    END IF;
    INSERT INTO public.transactions (id,business_id,type,status,counterparty_type,counterparty_id,subtotal_minor,discount_minor,tax_minor,
      total_minor,currency,reference,idempotency_key,transaction_date,created_by,source_document_id)
    VALUES (ledger_id,p_business_id,direction,'confirmed',CASE WHEN direction = 'sale' THEN 'customer' ELSE 'supplier' END,
      cp::text,subtotal,discount,tax,total,p_review->>'currency',ref,'document:'||p_document_id::text,occurred,auth.uid(),p_document_id);
    INSERT INTO public.transaction_items (transaction_id,product_name,quantity,unit_price_minor,discount_minor,tax_minor,total_minor)
    SELECT ledger_id,btrim(value->>'description'),(value->>'quantity')::bigint,(value->>'unitPriceMinor')::bigint,
      (value->>'discountMinor')::bigint,(value->>'taxMinor')::bigint,(value->>'totalMinor')::bigint
    FROM jsonb_array_elements(p_review->'items');
  END IF;
  UPDATE public.document_extractions SET status = 'validated', validated_at = now()
    WHERE business_id = p_business_id AND id = e.id AND document_id = p_document_id;
  UPDATE public.documents SET status = 'approved', reviewed_values = p_review, reviewed_by = auth.uid(), reviewed_at = now(),
    promoted_resource_type = CASE WHEN kind = 'invoice' THEN 'transaction' ELSE 'expense' END, promoted_resource_id = ledger_id
    WHERE business_id = p_business_id AND id = p_document_id;
  INSERT INTO public.audit_logs (business_id,user_id,action,resource_type,resource_id,before,after,metadata)
  VALUES (p_business_id,auth.uid(),'approve','document',p_document_id::text,jsonb_build_object('status',d.status),
    jsonb_build_object('status','approved','reviewedValues',p_review),
    jsonb_build_object('sourceDocumentId',p_document_id,'extractionId',e.id,'resourceId',ledger_id,
      'resourceType',CASE WHEN kind = 'invoice' THEN 'transaction' ELSE 'expense' END,'contentHash',d.content_hash));
  RETURN jsonb_build_object('resourceId',ledger_id,'replayed',false);
  -- No exception handler: any item, state or audit failure rolls the entire transaction back.
END;
$$;
REVOKE ALL ON FUNCTION public.promote_reviewed_document(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_reviewed_document(uuid,uuid,jsonb) TO authenticated;

-- Browser roles cannot forge promotion provenance or mark a document approved directly.
CREATE OR REPLACE FUNCTION public.guard_document_promotion()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND (
    NEW.status = 'approved' OR NEW.reviewed_values IS NOT NULL OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL
    OR NEW.promoted_resource_type IS NOT NULL OR NEW.promoted_resource_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'Promotion must use the reviewed promotion function' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_document_promotion ON public.documents;
CREATE TRIGGER trg_guard_document_promotion BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_promotion();

CREATE OR REPLACE FUNCTION public.guard_document_ledger_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.source_document_id IS DISTINCT FROM NEW.source_document_id THEN
    RAISE EXCEPTION 'Source document linkage is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.source_document_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND current_user IN ('authenticated','anon') THEN
      RAISE EXCEPTION 'Source linkage must be recorded by reviewed promotion' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.business_id = NEW.business_id AND d.id = NEW.source_document_id) THEN
      RAISE EXCEPTION 'Source document belongs to another tenant' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_transactions_document_source ON public.transactions;
CREATE TRIGGER trg_transactions_document_source BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_ledger_source();
DROP TRIGGER IF EXISTS trg_expenses_document_source ON public.expenses;
CREATE TRIGGER trg_expenses_document_source BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_document_ledger_source();

CREATE OR REPLACE FUNCTION public.sync_document_ingestion_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('review_required','approved','rejected','failed') THEN
    UPDATE public.ingestion_jobs SET state = CASE NEW.status
      WHEN 'review_required' THEN 'review' WHEN 'approved' THEN 'completed' ELSE 'failed' END,
      error = CASE WHEN NEW.status IN ('failed','rejected') THEN 'Document processing or review did not complete.' ELSE NULL END,
      completed_at = CASE WHEN NEW.status IN ('approved','rejected','failed') THEN now() ELSE NULL END
    WHERE business_id = NEW.business_id AND document_id = NEW.id AND state IN ('extracting','review');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_document_ingestion_status ON public.documents;
CREATE TRIGGER trg_document_ingestion_status AFTER UPDATE OF status ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.sync_document_ingestion_status();

-- Sources are immutable: replacement invalidates the evidence/hash. Cleanup can
-- remove an unregistered orphan, but never a source already referenced by metadata.
DROP POLICY IF EXISTS merchant_files_update ON storage.objects;
DROP POLICY IF EXISTS merchant_files_delete ON storage.objects;
CREATE POLICY merchant_files_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'merchant-files'
  AND (storage.foldername(name))[1] IN (SELECT id::text FROM public.businesses WHERE id IN (SELECT public.auth_user_businesses()))
  AND NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_path = name
    AND d.business_id::text = (storage.foldername(name))[1])
);
NOTIFY pgrst, 'reload schema';
