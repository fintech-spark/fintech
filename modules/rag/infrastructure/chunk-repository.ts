// Merchant Brain: pgvector chunk store
//
// TENANT ISOLATION
// ----------------
// `business_id` is bound from `TenantContext` on the method signature. It is
// not a parameter of `search()`, so there is no code path — and no input
// schema — through which a model could influence it. This is the primary
// control; the migration's RLS policies are defence in depth that happens to be
// inert for this connection (it authenticates as a BYPASSRLS role).
//
// MULTI-TENANT HNSW
// -----------------
// `idx_embeddings_embedding_hnsw` indexes the vector alone, not
// `(business_id, embedding)`. Postgres therefore walks the ANN graph and
// discards rows that fail the tenant predicate, and with the default
// `ef_search = 40` a small tenant can come back short or empty even when
// matching rows exist. Raising `ef_search` per query is the standard
// mitigation, so the search runs inside a transaction that sets it locally.
// `SET LOCAL` cannot be parameterised, which is why `hnswEfSearch` is coerced
// through `clampEfSearch` before it reaches the SQL string: it is a validated
// integer from configuration, never request data.

import 'server-only';

import type { BusinessId, DocumentId } from '@/lib/types';
import type { DatabaseClient } from '@/lib/database/client';
import type {
  ChunkMetadata,
  EmbeddingChunk,
  ScoredChunk,
} from '../domain/types';
import type { RetrievalRequest } from '../domain/types';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface EmbeddableChunk {
  readonly documentId: DocumentId;
  readonly content: string;
  readonly metadata: ChunkMetadata;
  readonly embedding: readonly number[];
}

export interface SimilaritySearch {
  readonly queryEmbedding: readonly number[];
  readonly limit: number;
  readonly minSimilarity: number;
  readonly sourceTypes?: readonly string[];
  readonly documentSourceTypes?: readonly string[];
}

export interface ChunkStore {
  save(businessId: BusinessId, chunks: readonly EmbeddableChunk[]): Promise<number>;
  deleteByDocument(businessId: BusinessId, documentId: DocumentId): Promise<number>;
  search(businessId: BusinessId, request: SimilaritySearch): Promise<readonly ScoredChunk[]>;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * Tenant-scoped cosine similarity search.
 *
 * `1 - (embedding <=> $2::vector)` converts pgvector's cosine DISTANCE into a
 * SIMILARITY, because `ScoredChunk.score` is defined as similarity in [-1, 1]
 * and a caller comparing it against a threshold must not have to know that.
 *
 * `$1` is the tenant and is always bound from the authenticated context.
 */
export const SIMILARITY_SEARCH_SQL = `
SELECT
  e.id,
  e.business_id,
  e.document_id,
  e.content,
  e.metadata,
  e.created_at,
  d.source_type AS document_source_type,
  d.file_name,
  d.uploaded_at,
  1 - (e.embedding <=> $2::vector) AS similarity
FROM document_embeddings e
JOIN documents d
  ON d.id = e.document_id
 AND d.business_id = e.business_id
 AND d.business_id = $1
WHERE e.business_id = $1
  AND e.embedding IS NOT NULL
  AND 1 - (e.embedding <=> $2::vector) >= $3
  AND (
    $4::text[] IS NULL
    OR e.metadata->>'sourceType' = ANY($4::text[])
  )
  AND (
    $5::text[] IS NULL
    OR d.source_type = ANY($5::text[])
  )
ORDER BY e.embedding <=> $2::vector
LIMIT $6
`.trim();

/** Replaces every chunk for a document so a re-index cannot duplicate it. */
export const DELETE_BY_DOCUMENT_SQL =
  'DELETE FROM document_embeddings WHERE business_id = $1 AND document_id = $2';

export const INSERT_CHUNK_SQL = `
INSERT INTO document_embeddings (business_id, document_id, content, metadata, embedding)
VALUES ($1, $2, $3, $4::jsonb, $5::vector)
`.trim();

/** Default ANN breadth. Higher recall, higher latency. */
export const DEFAULT_EF_SEARCH = 100;

const EF_SEARCH_MIN = 10;
const EF_SEARCH_MAX = 1000;

/**
 * Coerces `ef_search` into a safe integer range.
 *
 * Returns a literal safe to interpolate into `SET LOCAL`. Validation is the
 * whole point: this value is the only string in the retrieval path that is not
 * a bound parameter.
 */
export function clampEfSearch(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_EF_SEARCH;
  const rounded = Math.floor(value);
  if (rounded < EF_SEARCH_MIN) return EF_SEARCH_MIN;
  if (rounded > EF_SEARCH_MAX) return EF_SEARCH_MAX;
  return rounded;
}

/**
 * Serialises a vector for pgvector text input.
 *
 * Fixed to 6 decimal places: full float precision triples the parameter size
 * for no measurable recall gain, and rounding is deterministic so an identical
 * query produces an identical parameter.
 */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => value.toFixed(6)).join(',')}]`;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface ChunkRow {
  readonly id: string;
  readonly business_id: string;
  readonly document_id: string;
  readonly content: string;
  readonly metadata: Record<string, unknown> | null;
  readonly created_at: Date | string;
  readonly document_source_type: string;
  readonly file_name: string | null;
  readonly uploaded_at: Date | string;
  readonly similarity: number;
}

/**
 * Maps a database row to a `ScoredChunk`.
 *
 * Returns `null` for a row that does not carry usable provenance rather than
 * inventing defaults. An evidence item with no document reference cannot be
 * cited, so surfacing it would invite a fabricated citation.
 */
export function rowToScoredChunk(row: ChunkRow): ScoredChunk | null {
  const metadata = readMetadata(row.metadata);
  if (!metadata) return null;
  const sourceId = typeof metadata.sourceId === 'string' ? metadata.sourceId : null;
  if (!sourceId) return null;

  const chunk: EmbeddingChunk = {
    id: row.id,
    businessId: row.business_id,
    documentId: row.document_id as DocumentId,
    content: row.content,
    metadata,
    createdAt: toDate(row.created_at),
  };

  return { chunk, score: Number(row.similarity) };
}

function readMetadata(value: Record<string, unknown> | null): ChunkMetadata | null {
  if (!value) return null;
  const sourceId = value.sourceId;
  const chunkIndex = value.chunkIndex;
  if (typeof sourceId !== 'string' || typeof chunkIndex !== 'number') return null;

  return {
    businessId: typeof value.businessId === 'string' ? value.businessId : '',
    sourceId,
    sourceType: (value.sourceType as ChunkMetadata['sourceType']) ?? 'document',
    chunkIndex,
    totalChunks: typeof value.totalChunks === 'number' ? value.totalChunks : 0,
    chunkerVersion: typeof value.chunkerVersion === 'string' ? value.chunkerVersion : 'unknown',
    ...(typeof value.contentHash === 'string' ? { contentHash: value.contentHash } : {}),
    ...(typeof value.fileName === 'string' ? { fileName: value.fileName } : {}),
    ...(typeof value.pageNumber === 'number' ? { pageNumber: value.pageNumber } : {}),
    ...(typeof value.embeddingModel === 'string'
      ? { embeddingModel: value.embeddingModel }
      : {}),
    ...(typeof value.sourceTimestamp === 'string'
      ? { sourceTimestamp: value.sourceTimestamp }
      : {}),
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

// ---------------------------------------------------------------------------
// Postgres implementation
// ---------------------------------------------------------------------------

export interface PgChunkStoreOptions {
  readonly database: DatabaseClient;
  readonly efSearch?: number;
}

export class PgChunkStore implements ChunkStore {
  private readonly database: DatabaseClient;
  private readonly efSearch: number;

  constructor(options: PgChunkStoreOptions) {
    this.database = options.database;
    this.efSearch = clampEfSearch(options.efSearch);
  }

  async save(businessId: BusinessId, chunks: readonly EmbeddableChunk[]): Promise<number> {
    if (chunks.length === 0) return 0;

    return this.database.transaction(async (tx) => {
      let written = 0;
      for (const chunk of chunks) {
        const affected = await tx.execute(INSERT_CHUNK_SQL, [
          businessId,
          chunk.documentId,
          chunk.content,
          JSON.stringify({ ...chunk.metadata, businessId, embeddingModel: undefined }),
          toVectorLiteral(chunk.embedding),
        ]);
        written += affected;
      }
      return written;
    });
  }

  async deleteByDocument(businessId: BusinessId, documentId: DocumentId): Promise<number> {
    return this.database.execute(DELETE_BY_DOCUMENT_SQL, [businessId, documentId]);
  }

  async search(
    businessId: BusinessId,
    request: SimilaritySearch,
  ): Promise<readonly ScoredChunk[]> {
    const efSearch = this.efSearch;
    const vectorLiteral = toVectorLiteral(request.queryEmbedding);

    const rows = await this.database.transaction(async (tx) => {
      // Validated integer from configuration; see the file header.
      await tx.execute(`SET LOCAL hnsw.ef_search = ${efSearch}`);
      return tx.query<ChunkRow>(SIMILARITY_SEARCH_SQL, [
        businessId,
        vectorLiteral,
        request.minSimilarity,
        request.sourceTypes ? [...request.sourceTypes] : null,
        request.documentSourceTypes ? [...request.documentSourceTypes] : null,
        request.limit,
      ]);
    });

    const chunks: ScoredChunk[] = [];
    for (const row of rows) {
      // Defence in depth below the SQL. The query already filters on
      // `business_id`, but a future join change or alias slip would not be
      // caught by the type system, and a cross-tenant chunk that reaches the
      // context compiler is a data leak rather than a bad answer.
      if (row.business_id !== businessId) continue;
      const mapped = rowToScoredChunk(row);
      if (mapped) chunks.push(mapped);
    }
    return chunks;
  }
}

/** Re-exported so callers do not need to reach into the domain module. */
export type { RetrievalRequest };
