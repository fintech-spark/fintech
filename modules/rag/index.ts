export type {
  ChunkSourceType,
  IndexedDocumentSourceType,
  ChunkMetadata,
  EmbeddingChunk,
  ScoredChunk,
  RetrievalRequest,
  RetrievalResult,
  IngestionSource,
  IndexingOutcome,
} from './domain/types';

export {
  chunkText,
  hashChunk,
  hashContent,
  CHUNKER_VERSION,
  TARGET_CHUNK_CHARS,
  MAX_CHUNK_CHARS,
  OVERLAP_CHARS,
} from './domain/chunking';
export type { Chunk, ChunkInput } from './domain/chunking';

export {
  redactForEmbedding,
  classifyIndexingRisk,
} from './domain/redaction';
export type { RedactionKind, RedactionResult } from './domain/redaction';

export {
  applyRetrievalPolicy,
  assessFreshness,
  resolveTopK,
  resolveCandidateCount,
  DEFAULT_RETRIEVAL_POLICY,
  MAX_SIMILARITY,
} from './domain/retrieval-policy';
export type { Freshness, RetrievalPolicy, FilteredRetrieval } from './domain/retrieval-policy';

export type { RAGService, RAGIndexer, RagRetriever, ChunkTextSource } from './application/service';

export {
  DefaultRAGService,
  assessFreshness as labelChunkFreshness,
  MAX_QUERY_CHARS,
  MAX_SOURCE_CHARS,
} from './application/rag-service';
export type { RAGDependencies } from './application/rag-service';

export {
  ProviderEmbeddingProvider,
  categorise as categoriseEmbeddingFailure,
  isRetryableEmbeddingFailure,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_BATCH_SIZE,
} from './application/embedding-provider';
export type {
  EmbeddingProvider,
  EmbeddingVector,
  EmbeddingBatchResult,
  EmbeddingFailureCategory,
  ProviderEmbeddingOptions,
} from './application/embedding-provider';

export type {
  ChunkStore,
  EmbeddableChunk,
  SimilaritySearch,
  PgChunkStoreOptions,
} from './infrastructure/chunk-repository';
export {
  PgChunkStore,
  SIMILARITY_SEARCH_SQL,
  INSERT_CHUNK_SQL,
  DELETE_BY_DOCUMENT_SQL,
  clampEfSearch,
  toVectorLiteral,
  rowToScoredChunk,
  DEFAULT_EF_SEARCH,
} from './infrastructure/chunk-repository';
