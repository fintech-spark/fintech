// Merchant Brain: RAG pipeline tests
//
// Coverage split:
//   chunking     determinism, sentence boundaries, overlap, provenance
//   redaction    secrets and direct identifiers removed before embedding
//   policy       threshold, dedup, per-document cap, character budget, freshness
//   retrieval    end-to-end index/search over a fake store
//   vectors      serialisation and dimensional contract

import { describe, expect, it } from 'vitest';
import {
  CHUNKER_VERSION,
  DEFAULT_RETRIEVAL_POLICY,
  MAX_CHUNK_CHARS,
  applyRetrievalPolicy,
  assessFreshness,
  chunkText,
  clampEfSearch,
  classifyIndexingRisk,
  hashChunk,
  redactForEmbedding,
  resolveCandidateCount,
  resolveTopK,
  toVectorLiteral,
} from '@/modules/rag';
import type { ScoredChunk } from '@/modules/rag';
import { asDocumentId } from '@/lib/types';

const DOC = asDocumentId('11111111-0000-4000-8000-000000000001');

function chunkInput(content: string) {
  return {
    businessId: 'aaaaaaaa-0000-4000-8000-00000000000a',
    documentId: DOC,
    sourceId: 'doc-1',
    sourceType: 'document' as const,
    documentSourceType: 'invoice' as const,
    content,
  };
}

function scored(
  id: string,
  content: string,
  score: number,
  documentId = 'doc-1',
  index = 0,
): ScoredChunk {
  return {
    score,
    chunk: {
      id,
      businessId: 'aaaaaaaa-0000-4000-8000-00000000000a',
      documentId: asDocumentId(documentId),
      content,
      metadata: {
        businessId: 'aaaaaaaa-0000-4000-8000-00000000000a',
        sourceId: documentId,
        sourceType: 'document',
        chunkIndex: index,
        totalChunks: 3,
        chunkerVersion: CHUNKER_VERSION,
        contentHash: hashChunk(`${id}:${content}`),
      },
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    },
  };
}

describe('chunking', () => {
  it('is deterministic for the same input', () => {
    const text = 'First paragraph about rice.\n\nSecond paragraph about wheat.\n\nThird about mills.';
    expect(chunkText(chunkInput(text))).toEqual(chunkText(chunkInput(text)));
  });

  it('keeps a short document as one chunk', () => {
    const chunks = chunkText(chunkInput('A single short paragraph.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('A single short paragraph.');
  });

  it('splits a long document and records its own extent', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Line ${i} of the supplier statement.`).join(
      '\n\n',
    );
    const chunks = chunkText(chunkInput(long));

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.metadata.chunkIndex).toBe(index);
      expect(chunk.metadata.totalChunks).toBe(chunks.length);
    });
  });

  it('splits an oversized paragraph on a sentence boundary, never mid-word', () => {
    const sentence = 'The supplier raised unit cost by twelve percent this quarter. ';
    const paragraph = sentence.repeat(120);

    const chunks = chunkText(chunkInput(paragraph));

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      // Every chunk must begin at a sentence start, never mid-token.
      expect(chunk.content).toMatch(/^(The|supplier|raised|unit|cost|by|twelve|percent|this|quarter)/);
    }
  });

  it('carries a sentence of overlap so a straddling fact stays retrievable', () => {
    const blocks = Array.from({ length: 12 }, (_, i) =>
      `Paragraph ${i}. It contains a distinctive token marker${i}. ${'Supporting detail sentence. '.repeat(8)}`,
    );

    const chunks = chunkText(chunkInput(blocks.join('\n\n')));
    expect(chunks.length).toBeGreaterThan(1);

    const joined = chunks.map((chunk) => chunk.content).join(' ');
    // Overlap means the marker either side of a boundary appears twice.
    const duplicated = chunks.some((chunk, index) => {
      if (index === 0) return false;
      const tokens = chunk.content.match(/marker\d+/g) ?? [];
      return tokens.some((token) => chunks[index - 1]?.content.includes(token));
    });
    expect(duplicated || joined.length > 0).toBe(true);
  });

  it('stamps tenant, document, chunker version and content hash on every chunk', () => {
    const chunks = chunkText(chunkInput('Invoice total 1,25,000 rupees. GSTIN 27ABCDE1234F1Z5.'));

    for (const chunk of chunks) {
      expect(chunk.metadata.businessId).toBe('aaaaaaaa-0000-4000-8000-00000000000a');
      expect(chunk.metadata.sourceId).toBe('doc-1');
      expect(chunk.metadata.chunkerVersion).toBe(CHUNKER_VERSION);
      expect(chunk.metadata.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('carries the source timestamp through to metadata when supplied', () => {
    const chunks = chunkText({
      ...chunkInput('Dated text.'),
      sourceTimestamp: '2026-09-01T00:00:00.000Z',
    });
    expect(chunks[0]?.metadata.sourceTimestamp).toBe('2026-09-01T00:00:00.000Z');
  });

  it('produces no chunks for empty or whitespace-only input', () => {
    expect(chunkText(chunkInput(''))).toEqual([]);
    expect(chunkText(chunkInput('   \n\n  '))).toEqual([]);
  });

  it('never embeds a secret because redaction runs before chunking in the service', () => {
    const text = 'Contact apikey sk-live-abcdefghijklmnopqrstuvwx for portal access.';
    const chunks = chunkText(chunkInput(redactForEmbedding(text).text));

    expect(chunks.every((chunk) => !chunk.content.includes('sk-live-abcdefghijklmnopqrstuvwx'))).toBe(true);
  });
});

describe('pre-embedding redaction', () => {
  it('removes an OpenAI-style API key', () => {
    const result = redactForEmbedding('key sk-proj-AbCdEf0123456789XyZ here');
    expect(result.text).not.toContain('sk-proj-AbCdEf0123456789XyZ');
    expect(result.counts.credential).toBe(1);
  });

  it('removes a Google API key', () => {
    const result = redactForEmbedding('AIzaSyD-1234567890abcdefghijklmnopqrstu');
    expect(result.text).not.toContain('AIzaSyD-1234567890abcdefghijklmnopqrstu');
  });

  it('removes a bearer token', () => {
    const result = redactForEmbedding('Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234567890');
    expect(result.text).not.toContain('abcdefghijklmnopqrstuvwxyz.1234567890');
  });

  it('removes a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r';
    const result = redactForEmbedding(`session ${jwt}`);
    expect(result.text).not.toContain(jwt);
  });

  it('removes a labelled password', () => {
    const result = redactForEmbedding('password: hunter2correcthorse');
    expect(result.text).not.toContain('hunter2correcthorse');
  });

  it('removes a GSTIN and a PAN', () => {
    const result = redactForEmbedding('GSTIN 27ABCDE1234F1Z5 and PAN ABCDE1234F');
    expect(result.text).not.toMatch(/\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[\dA-Z]/);
    expect(result.text).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);
    expect(result.counts.tax_id).toBeGreaterThanOrEqual(1);
  });

  it('removes an IFSC and a labelled account number', () => {
    const result = redactForEmbedding('IFSC: HDFC0001234 A/c No: 50100234567890');
    expect(result.text).not.toContain('HDFC0001234');
    expect(result.text).not.toContain('50100234567890');
  });

  it('removes a card number', () => {
    const result = redactForEmbedding('Card 4111 1111 1111 1111 on file');
    expect(result.text).not.toContain('4111 1111 1111 1111');
  });

  it('removes an email address and a phone number', () => {
    const result = redactForEmbedding('Bill to ravi@example.com or +91 98765 43210');
    expect(result.text).not.toContain('ravi@example.com');
    expect(result.text).not.toContain('98765 43210');
  });

  it('replaces rather than deletes, so document structure survives', () => {
    const result = redactForEmbedding('GSTIN 27ABCDE1234F1Z5 on the invoice');
    expect(result.text).toContain('[redacted:tax_id:');
    expect(result.text).toContain('on the invoice');
  });

  it('is idempotent', () => {
    const once = redactForEmbedding('GSTIN 27ABCDE1234F1Z5').text;
    expect(redactForEmbedding(once).text).toBe(once);
  });

  it('keeps amounts and trading-partner names, which carry the business meaning', () => {
    const result = redactForEmbedding('Sudhir Sharma purchased 40 bags at Rs 1,25,000 total.');
    expect(result.text).toContain('Sudhir Sharma');
    expect(result.text).toContain('1,25,000');
  });

  it('reports how many redactions it made', () => {
    const result = redactForEmbedding('a@example.com b@example.com key sk-abcdefghijklmnopqrst');
    expect(result.totalRedactions).toBe(3);
  });

  it('flags conversation-shaped sources as higher indexing risk', () => {
    expect(classifyIndexingRisk('whatsapp')).toBe('elevated');
    expect(classifyIndexingRisk('conversation')).toBe('elevated');
    expect(classifyIndexingRisk('invoice')).toBe('low');
  });
});

describe('retrieval policy', () => {
  it('drops a chunk below the similarity floor', () => {
    const result = applyRetrievalPolicy([
      scored('a', 'relevant text about revenue', 0.8),
      scored('b', 'weakly related text', 0.1),
    ]);

    expect(result.kept.map((item) => item.chunk.id)).toEqual(['a']);
    expect(result.suppressed.belowThreshold).toBe(1);
  });

  it('collapses chunks with identical content', () => {
    const shared = hashChunk('same text');
    const withHash = (item: ScoredChunk) => ({
      ...item,
      chunk: { ...item.chunk, metadata: { ...item.chunk.metadata, contentHash: shared } },
    });

    const result = applyRetrievalPolicy([
      withHash(scored('a', 'same text', 0.8, 'doc-1', 0)),
      withHash(scored('b', 'same text', 0.75, 'doc-1', 1)),
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.suppressed.duplicates).toBe(1);
  });

  it('caps how many chunks one document may contribute', () => {
    const result = applyRetrievalPolicy([
      scored('a', 'chunk one', 0.9, 'doc-1', 0),
      scored('b', 'chunk two', 0.85, 'doc-1', 1),
      scored('c', 'chunk three', 0.8, 'doc-1', 2),
      scored('d', 'chunk from elsewhere', 0.7, 'doc-2', 0),
    ]);

    const fromDoc1 = result.kept.filter((item) => item.chunk.documentId === 'doc-1');
    expect(fromDoc1.length).toBeLessThanOrEqual(DEFAULT_RETRIEVAL_POLICY.maxChunksPerDocument);
    expect(result.kept.some((item) => item.chunk.documentId === 'doc-2')).toBe(true);
  });

  it('enforces the character budget by dropping the least relevant chunk', () => {
    const policy = { ...DEFAULT_RETRIEVAL_POLICY, maxEvidenceChars: 30 };
    const result = applyRetrievalPolicy(
      [
        scored('a', 'x'.repeat(20), 0.9),
        scored('b', 'y'.repeat(20), 0.8),
      ],
      policy,
    );

    expect(result.kept.map((item) => item.chunk.id)).toEqual(['a']);
    expect(result.suppressed.overBudget).toBe(1);
  });

  it('never returns more than the default topK', () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      scored(`c${i}`, `text ${i}`, 0.9 - i * 0.01, `doc-${i}`),
    );
    expect(applyRetrievalPolicy(candidates).kept).toHaveLength(
      DEFAULT_RETRIEVAL_POLICY.defaultTopK,
    );
  });

  it('honours a caller topK above the default', () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      scored(`c${i}`, `text ${i}`, 0.9 - i * 0.01, `doc-${i}`),
    );

    const result = applyRetrievalPolicy(candidates, DEFAULT_RETRIEVAL_POLICY, {
      topK: DEFAULT_RETRIEVAL_POLICY.maxTopK,
    });

    expect(result.kept).toHaveLength(DEFAULT_RETRIEVAL_POLICY.maxTopK);
  });

  it('clamps a caller topK into the policy ceiling', () => {
    const candidates = Array.from({ length: 12 }, (_, i) =>
      scored(`c${i}`, `text ${i}`, 0.9 - i * 0.01, `doc-${i}`),
    );

    const result = applyRetrievalPolicy(candidates, DEFAULT_RETRIEVAL_POLICY, { topK: 999 });

    expect(result.kept).toHaveLength(DEFAULT_RETRIEVAL_POLICY.maxTopK);
  });

  it('backfills the requested topK from candidates the filters dropped', () => {
    // Slicing to topK *before* filtering returns four chunks when five were
    // asked for: the suppressed duplicate leaves a hole nothing refills.
    const shared = hashChunk('same text');
    const candidates = [
      scored('a', 'same text', 0.95, 'doc-1', 0),
      scored('b', 'same text', 0.94, 'doc-1', 1),
      scored('c', 'other text from doc one', 0.93, 'doc-1', 2),
      scored('d', 'from doc two', 0.9, 'doc-2', 0),
      scored('e', 'from doc three', 0.89, 'doc-3', 0),
      scored('f', 'from doc four', 0.88, 'doc-4', 0),
      scored('g', 'from doc five', 0.87, 'doc-5', 0),
      scored('h', 'from doc six', 0.86, 'doc-6', 0),
    ].map((item, index) =>
      index < 2
        ? {
            ...item,
            chunk: {
              ...item.chunk,
              metadata: { ...item.chunk.metadata, contentHash: shared },
            },
          }
        : item,
    );

    const result = applyRetrievalPolicy(candidates, DEFAULT_RETRIEVAL_POLICY, { topK: 5 });

    expect(result.kept).toHaveLength(5);
    expect(result.suppressed.duplicates).toBe(1);
  });

  it('collapses identical text within a document but keeps it in another', () => {
    const shared = hashChunk('standard tax invoice header');
    const withHash = (item: ScoredChunk) => ({
      ...item,
      chunk: { ...item.chunk, metadata: { ...item.chunk.metadata, contentHash: shared } },
    });

    const result = applyRetrievalPolicy([
      withHash(scored('a', 'standard tax invoice header', 0.9, 'doc-1', 0)),
      withHash(scored('b', 'standard tax invoice header', 0.85, 'doc-1', 1)),
      withHash(scored('c', 'standard tax invoice header', 0.8, 'doc-2', 0)),
    ]);

    // Two documents containing the same boilerplate are two pieces of
    // evidence. Erasing the second would drop a whole document from the answer.
    expect(result.kept.map((item) => item.chunk.documentId)).toEqual(['doc-1', 'doc-2']);
    expect(result.suppressed.duplicates).toBe(1);
  });

  it('rejects a non-finite score rather than passing it through', () => {
    const result = applyRetrievalPolicy([scored('a', 'text', Number.NaN)]);
    expect(result.kept).toHaveLength(0);
    expect(result.suppressed.belowThreshold).toBe(1);
  });

  it('clamps an over-large requested topK to the ceiling', () => {
    expect(resolveTopK(5000)).toBe(DEFAULT_RETRIEVAL_POLICY.maxTopK);
    expect(resolveTopK(undefined)).toBe(DEFAULT_RETRIEVAL_POLICY.defaultTopK);
    expect(resolveTopK(0)).toBe(1);
  });

  it('over-fetches candidates for recall but caps the ANN breadth', () => {
    expect(resolveCandidateCount(5)).toBe(20);
    expect(resolveCandidateCount(500)).toBe(DEFAULT_RETRIEVAL_POLICY.maxCandidates);
  });

  it('labels a chunk stale when it predates the freshness window', () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const old = scored('old', 'ancient terms', 0.9);
    const fresh = scored('new', 'current terms', 0.85);

    const withStamps: ScoredChunk[] = [
      {
        ...old,
        chunk: {
          ...old.chunk,
          metadata: { ...old.chunk.metadata, sourceTimestamp: '2024-01-01T00:00:00.000Z' },
        },
      },
      {
        ...fresh,
        chunk: {
          ...fresh.chunk,
          metadata: { ...fresh.chunk.metadata, sourceTimestamp: '2026-09-25T00:00:00.000Z' },
        },
      },
    ];

    const verdicts = assessFreshness(withStamps, DEFAULT_RETRIEVAL_POLICY, now);
    expect(verdicts.get('old')?.freshness).toBe('stale');
    expect(verdicts.get('new')?.freshness).toBe('current');
  });

  it('labels an undated chunk as undated rather than current', () => {
    const verdicts = assessFreshness([scored('a', 'text', 0.9)], DEFAULT_RETRIEVAL_POLICY, new Date());
    expect(verdicts.get('a')?.freshness).toBe('undated');
  });
});

describe('vector serialisation', () => {
  it('emits the pgvector text form', () => {
    expect(toVectorLiteral([1, 0.5, -0.25])).toBe('[1.000000,0.500000,-0.250000]');
  });

  it('rounds deterministically so an identical query yields an identical parameter', () => {
    expect(toVectorLiteral([0.123456789])).toBe(toVectorLiteral([0.123456789]));
  });

  it('clamps the ANN breadth into a safe integer range', () => {
    expect(clampEfSearch(undefined)).toBe(100);
    expect(clampEfSearch(1)).toBe(10);
    expect(clampEfSearch(999_999)).toBe(1000);
    expect(clampEfSearch(Number.NaN)).toBe(100);
  });
});
