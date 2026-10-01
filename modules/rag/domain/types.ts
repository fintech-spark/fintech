import type { BusinessId } from '@/lib/types';
export interface EmbeddingChunk { readonly id: string; readonly businessId: BusinessId; readonly content: string; readonly metadata: ChunkMetadata; readonly embedding?: readonly number[]; readonly createdAt: Date; }
export interface ChunkMetadata { readonly sourceId: string; readonly sourceType: 'document' | 'conversation' | 'note' | 'voice_transcript' | 'whatsapp'; readonly fileName?: string; readonly pageNumber?: number; readonly chunkIndex: number; readonly totalChunks: number; }
export interface RetrievalQuery { readonly businessId: BusinessId; readonly queryText: string; readonly topK: number; readonly sourceTypes?: readonly ChunkMetadata['sourceType'][]; readonly minScore?: number; }
export interface RetrievalResult { readonly chunks: readonly ScoredChunk[]; readonly queryEmbedding?: readonly number[]; }
export interface ScoredChunk { readonly chunk: EmbeddingChunk; readonly score: number; }
