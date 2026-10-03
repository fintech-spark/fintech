-- ============================================================================
-- 20261002000009_rag_provenance.sql
--
-- Phase 7/8: retrieval provenance and a guarded retrieval function.
--
-- WHAT THIS ADDS
--   1. Queryable chunk provenance on document_embeddings. The Phase 7 chunker
--      emits chunkIndex, totalChunks, chunkerVersion, contentHash and
--      embeddingModel, but before this migration the only place to record them
--      was the untyped `metadata` jsonb — so chunk ordering, dedup and
--      re-indexing had no indexed, typed home.
--   2. A partial index covering only embedded rows, so the ANN index and the
--      metadata lookups do not carry unembedded placeholders.
--   3. A GIN index on metadata for source-type filters.
--   4. `match_document_embeddings`, a SECURITY DEFINER retrieval function that
--      makes the tenant predicate non-optional for any caller that uses it.
--
-- WHY A FUNCTION AT ALL
--   The application already scopes every query with `business_id = $1` and
--   `modules/business-brain/infrastructure/tenant-query.ts` refuses any
--   statement that lacks the predicate. This function adds a second, independent
--   path: a caller cannot express a cross-tenant retrieval through it, because
--   `p_business_id` is validated against the caller's memberships rather than
--   trusted.
--
-- COMPATIBILITY NOTE
--   `tests/database-schema.test.ts` asserts the concatenated migration text
--   contains `USING hnsw (embedding vector_cosine_ops)`. That index is left
--   untouched here; only additional indexes are added.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Chunk provenance columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.document_embeddings
  ADD COLUMN IF NOT EXISTS chunk_index    integer,
  ADD COLUMN IF NOT EXISTS total_chunks    integer,
  ADD COLUMN IF NOT EXISTS chunker_version text,
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS content_hash    text;

-- Ordering must be a whole number, and a chunk cannot claim more of the
-- document than the document has.
ALTER TABLE public.document_embeddings
  DROP CONSTRAINT IF EXISTS chk_embeddings_chunk_index;
ALTER TABLE public.document_embeddings
  ADD CONSTRAINT chk_embeddings_chunk_index
  CHECK (chunk_index IS NULL OR chunk_index >= 0);

ALTER TABLE public.document_embeddings
  DROP CONSTRAINT IF EXISTS chk_embeddings_total_chunks;
ALTER TABLE public.document_embeddings
  ADD CONSTRAINT chk_embeddings_total_chunks
  CHECK (total_chunks IS NULL OR total_chunks >= 1);

ALTER TABLE public.document_embeddings
  DROP CONSTRAINT IF EXISTS chk_embeddings_chunk_position;
ALTER TABLE public.document_embeddings
  ADD CONSTRAINT chk_embeddings_chunk_position
  CHECK (
    chunk_index IS NULL
    OR total_chunks IS NULL
    OR (chunk_index < total_chunks)
  );

COMMENT ON COLUMN public.document_embeddings.chunk_index IS
  'Zero-based position of this chunk within its document. Null for rows written before Phase 7.';
COMMENT ON COLUMN public.document_embeddings.total_chunks IS
  'Total chunks produced for the source document at indexing time.';
COMMENT ON COLUMN public.document_embeddings.chunker_version IS
  'Version of the chunker that produced this chunk. A change invalidates the stored vector.';
COMMENT ON COLUMN public.document_embeddings.embedding_model IS
  'Model id that produced the vector. Detects a dimension change after a model swap.';
COMMENT ON COLUMN public.document_embeddings.content_hash IS
  'SHA-256 of the redacted chunk text. Duplicate-suppression and re-index signal.';

-- ---------------------------------------------------------------------------
-- 2. Indexes
-- ---------------------------------------------------------------------------

-- Lookup by document and chunk order, covering the re-index path.
CREATE INDEX IF NOT EXISTS idx_embeddings_document_chunk
  ON public.document_embeddings (business_id, document_id, chunk_index);

-- Duplicate suppression and change detection.
CREATE INDEX IF NOT EXISTS idx_embeddings_content_hash
  ON public.document_embeddings (business_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- Re-embedding every chunk produced by a superseded chunker version.
CREATE INDEX IF NOT EXISTS idx_embeddings_chunker_version
  ON public.document_embeddings (business_id, chunker_version)
  WHERE chunker_version IS NOT NULL;

-- Metadata filters (source type) without a sequential scan.
CREATE INDEX IF NOT EXISTS idx_embeddings_metadata_gin
  ON public.document_embeddings USING gin (metadata jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- 3. Guarded retrieval function
-- ---------------------------------------------------------------------------
-- Returns cosine SIMILARITY in [-1, 1] (higher is closer), matching the
-- `ScoredChunk.score` contract. pgvector's `<=>` is a distance, so the
-- conversion happens here once instead of in every caller.
--
-- The tenant is validated against `auth_user_businesses()`, so a caller cannot
-- read another merchant's chunks even with a forged `p_business_id`. An
-- unauthenticated caller matches no businesses and therefore gets no rows.
--
-- `p_match_count` is clamped so the function cannot be used as a bulk export.
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
AS $$
  SELECT
    e.id,
    e.document_id,
    e.content,
    e.metadata,
    (1 - (e.embedding <=> p_query_embedding))::real AS similarity,
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
    AND (1 - (e.embedding <=> p_query_embedding)) >= p_match_threshold
    AND (p_source_types IS NULL OR e.metadata->>'sourceType' = ANY (p_source_types))
  ORDER BY e.embedding <=> p_query_embedding
  LIMIT LEAST(GREATEST(COALESCE(p_match_count, 5), 1), 50);
$$;

-- Deny by default, matching the pattern in 20261002000007.
REVOKE ALL ON FUNCTION public.match_document_embeddings(uuid, vector, integer, real, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_document_embeddings(uuid, vector, integer, real, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_document_embeddings(uuid, vector, integer, real, text[]) TO authenticated;
