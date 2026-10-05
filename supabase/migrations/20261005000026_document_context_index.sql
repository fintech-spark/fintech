ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS rag_indexing_status text NOT NULL DEFAULT 'pending'
  CHECK (rag_indexing_status IN ('pending','indexed','insufficient_evidence','failed'));
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS rag_chunk_count integer NOT NULL DEFAULT 0 CHECK (rag_chunk_count >= 0);
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS rag_indexing_error text;
NOTIFY pgrst, 'reload schema';
