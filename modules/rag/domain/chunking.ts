// Merchant Brain: RAG chunking
//
// Deterministic and pure. Same input always yields the same chunks, which is
// what makes the content hash a usable dedup and re-index signal.
//
// Strategy: paragraph-first, then sentence-boundary packing.
//
// Fixed-width splitting is the classic failure — it cuts mid-sentence and the
// resulting embedding represents a fragment, so retrieval returns plausible but
// contextless text. Here paragraphs are the atomic unit and only paragraphs too
// large to fit are split, and those are split on sentence terminators. Neighbour
// chunks overlap by whole sentences so a fact that straddles a boundary is
// still retrievable from at least one chunk.
//
// The version string is embedded in every chunk's metadata: chunking changes
// invalidate vectors, and without a version there is no way to know which
// chunks need re-embedding.

import { createHash } from 'node:crypto';
import type { ChunkSourceType, IndexedDocumentSourceType, ChunkMetadata } from './types';

/** Bump when the algorithm changes; it invalidates existing vectors. */
export const CHUNKER_VERSION = 'rag-chunker.v1';

/**
 * Target chunk size in characters.
 *
 * ~1200 characters is roughly 250-300 tokens: enough to hold a whole invoice
 * line group or a short message thread, small enough that five retrieved chunks
 * fit a prompt with room for the structured facts. Retrieval caps context at a
 * handful of chunks, so a larger chunk buys context at the cost of precision.
 */
export const TARGET_CHUNK_CHARS = 1200;

/** Hard ceiling; a single oversized paragraph is split down to this. */
export const MAX_CHUNK_CHARS = 1600;

/**
 * Overlap carried into the next chunk, in characters.
 *
 * One sentence of context, not a percentage of the chunk. A percentage overlap
 * on short chunks duplicates most of the corpus and floods the prompt with
 * near-identical text.
 */
export const OVERLAP_CHARS = 200;

export interface ChunkInput {
  readonly businessId: string;
  readonly documentId: string;
  readonly sourceId: string;
  readonly sourceType: ChunkSourceType;
  readonly documentSourceType: IndexedDocumentSourceType;
  readonly content: string;
  readonly fileName?: string;
  readonly pageNumber?: number;
  readonly sourceTimestamp?: string;
}

export interface Chunk {
  readonly content: string;
  readonly metadata: ChunkMetadata;
}

const PARAGRAPH_SPLIT = /\n\s*\n+/;
const SENTENCE_SPLIT = /(?<=[.!?।])\s+/;

export function chunkText(input: ChunkInput): Chunk[] {
  const paragraphs = input.content
    .split(PARAGRAPH_SPLIT)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const blocks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK_CHARS) {
      blocks.push(paragraph);
      continue;
    }
    blocks.push(...splitOversizedParagraph(paragraph));
  }

  const packed = packBlocks(blocks);
  const totalChunks = packed.length;

  return packed.map((content, chunkIndex) => ({
    content,
    metadata: buildMetadata(input, chunkIndex, totalChunks),
  }));
}

function buildMetadata(
  input: ChunkInput,
  chunkIndex: number,
  totalChunks: number,
): ChunkMetadata {
  return {
    businessId: input.businessId,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    chunkIndex,
    totalChunks,
    chunkerVersion: CHUNKER_VERSION,
    contentHash: hashContent(input.content),
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(input.pageNumber !== undefined ? { pageNumber: input.pageNumber } : {}),
    ...(input.sourceTimestamp ? { sourceTimestamp: input.sourceTimestamp } : {}),
  };
}

/** SHA-256 of the whole source document: identifies a document version. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** SHA-256 of one chunk's text: the duplicate-suppression key. */
export function hashChunk(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function splitOversizedParagraph(paragraph: string): string[] {
  const sentences = paragraph
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const out: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length === 0) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= MAX_CHUNK_CHARS) {
      current = `${current} ${sentence}`;
    } else {
      out.push(current);
      current = sentence;
    }

    // A single sentence longer than the ceiling is hard-split. Nothing else
    // can bound it without cutting mid-word, which is the lesser evil.
    while (current.length > MAX_CHUNK_CHARS) {
      out.push(current.slice(0, MAX_CHUNK_CHARS));
      current = current.slice(MAX_CHUNK_CHARS);
    }
  }

  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Greedy paragraph packing with sentence-level overlap.
 *
 * Greedy rather than optimal: it is deterministic, linear, and for the paragraph
 * lengths found in invoices and chat exports the packing efficiency difference
 * is not worth a dynamic program.
 *
 * The overlap is dropped when it would push the next chunk past
 * `MAX_CHUNK_CHARS`. Carrying overlap is worth less than the ceiling being real:
 * a chunk over the ceiling costs embedding budget and retrieval precision, and
 * an oversized paragraph is already split before it reaches here.
 */
function packBlocks(blocks: readonly string[]): string[] {
  if (blocks.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    const candidate = current.length === 0 ? block : `${current}\n\n${block}`;
    if (candidate.length <= TARGET_CHUNK_CHARS) {
      current = candidate;
      continue;
    }

    if (current.length === 0) {
      current = block;
      continue;
    }

    chunks.push(current);
    const withOverlap = `${tailOf(current, OVERLAP_CHARS)}\n\n${block}`;
    current = withOverlap.length <= MAX_CHUNK_CHARS ? withOverlap : block;
  }

  if (current.trim().length > 0) chunks.push(current);
  return chunks;
}

/** The trailing slice used as overlap, aligned to a sentence boundary. */
function tailOf(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(text.length - maxChars);
  const boundary = slice.search(/[.!?।]\s/);
  if (boundary === -1) return slice;
  return slice.slice(boundary + 1).trim();
}
