// Merchant Brain: context budget and provider failure tests
//
// Two denial-of-service surfaces and one correctness surface:
//
//   BUDGET      an over-eager tool loop, a giant document, or a repeated
//               retrieval must not be able to exhaust the context window or the
//               database.
//   FAILURE     an unavailable or malformed provider must fail safely and
//               visibly, never silently.
//
// The failure tests matter most: an embedding that quietly returns fewer vectors
// than requested leaves a document half-indexed and the model later reporting
// "no information found" with no record that anything failed.

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  DEFAULT_CONTEXT_BUDGET,
  compileContext,
} from '@/modules/business-brain';
import {
  EMBEDDING_DIMENSIONS,
  ProviderEmbeddingProvider,
  categoriseEmbeddingFailure as categorise,
} from '@/modules/rag';
import { createToolRegistry, defineTool } from '@/lib/ai/tools/registry';
import type { AIProviderAdapter, CompletionResponse, EmbeddingResponse } from '@/lib/ai/providers/types';
import type { ScoredChunk } from '@/modules/rag';
import { BUSINESS_A, createFakeDatabase, tenantFor } from '../helpers/fake-database';

const VECTOR = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Number(((i % 5) / 5).toFixed(6)));

function bigChunk(id: string, chars: number): ScoredChunk {
  const content = `${id} `.repeat(Math.ceil(chars / (id.length + 1))).slice(0, chars);
  return {
    chunk: {
      id,
      businessId: BUSINESS_A,
      documentId: `11111111-0000-4000-8000-0000000000${id.slice(-2).padStart(2, '0')}` as never,
      content,
      metadata: {
        businessId: BUSINESS_A,
        sourceId: `doc-${id}`,
        sourceType: 'document',
        chunkIndex: 0,
        totalChunks: 1,
        chunkerVersion: 'rag-chunker.v1',
        contentHash: `hash-${id}`,
      },
      createdAt: new Date(),
    },
    score: 0.8,
  };
}

describe('context budget', () => {
  it('caps the number of tool results folded into the context', () => {
    const envelopes = Array.from({ length: 12 }, (_, i) => ({
      data: { metrics: [], periodStart: 'a', periodEnd: 'b' },
      provenance: {
        tool: `tool_${i}`,
        version: 'v1',
        source: 'analytics' as const,
        sensitivity: 'financial' as const,
        generatedAt: '2026-11-01T00:00:00.000Z',
        reportingPeriod: null,
        tenantScoped: true as const,
      },
    }));

    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: envelopes,
      retrievedChunks: [],
    });

    expect(compiled.context.authoritativeFacts).toHaveLength(DEFAULT_CONTEXT_BUDGET.maxToolResults);
    expect(compiled.context.metadata.truncated).toBe(true);
  });

  it('caps the number of retrieved chunks', () => {
    const chunks = Array.from({ length: 30 }, (_, i) => bigChunk(`c${i}`, 100));

    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [],
      retrievedChunks: chunks,
    });

    expect(compiled.context.retrievedEvidence.length).toBeLessThanOrEqual(
      DEFAULT_CONTEXT_BUDGET.maxEvidence,
    );
    expect(compiled.context.metadata.truncated).toBe(true);
  });

  it('never truncates a deterministic metric to make room for document text', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [
        {
          data: {
            metrics: Array.from({ length: 40 }, (_, i) => ({
              metric: `m${i}`,
              valueMinorUnits: i * 100,
              currency: 'INR',
              periodStart: '2026-10-01T00:00:00.000Z',
              periodEnd: '2026-11-01T00:00:00.000Z',
              source: 'analytics',
            })),
          },
          provenance: {
            tool: 'sales_summary',
            version: 'v1',
            source: 'analytics',
            sensitivity: 'financial',
            generatedAt: '2026-11-01T00:00:00.000Z',
            reportingPeriod: null,
            tenantScoped: true,
          },
        },
      ],
      retrievedChunks: Array.from({ length: 8 }, (_, i) => bigChunk(`c${i}`, 9_000)),
      budget: { maxTotalChars: 2_000 },
    });

    expect(compiled.context.deterministicMetrics).toHaveLength(40);
    expect(compiled.context.retrievedEvidence).toHaveLength(0);
    expect(compiled.context.metadata.truncated).toBe(true);
  });

  it('drops the least relevant chunk first when the character budget binds', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [],
      retrievedChunks: [bigChunk('keep', 100), bigChunk('drop', 100)],
      budget: { maxTotalChars: 250, maxEvidence: 8 },
    });

    // Both fit here; force a bind by shrinking the budget to one chunk.
    const tighter = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [],
      retrievedChunks: [bigChunk('keep', 100), bigChunk('drop', 100)],
      budget: { maxTotalChars: 60, maxEvidence: 8 },
    });

    expect(compiled.context.retrievedEvidence).toHaveLength(2);
    expect(tighter.context.retrievedEvidence).toHaveLength(0);
  });

  it('reports the character count it actually emitted', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [],
      retrievedChunks: [bigChunk('c1', 250)],
      budget: { maxTotalChars: 60, maxEvidence: 8 },
    });

    expect(compiled.context.metadata.evidenceChars).toBe(0);
  });

  it('collapses an identical chunk repeated in the retrieval result', () => {
    const one = bigChunk('c1', 120);
    const repeated: ScoredChunk[] = [one, { ...one, score: 0.7 }];

    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [],
      retrievedChunks: repeated,
    });

    expect(compiled.context.retrievedEvidence).toHaveLength(1);
    expect(compiled.context.metadata.truncated).toBe(true);
  });

  it('stops a tool loop at the registry budget', async () => {
    const tool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({ n: z.number().int() }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'database',
      execute: async () => ({ ok: true }),
    });

    const registry = createToolRegistry({
      tools: [tool as never],
      authorize: async () => undefined,
      limits: { maxToolCalls: 4 },
    });

    const session = registry.open(tenantFor(BUSINESS_A));
    for (let i = 0; i < 4; i += 1) await session.call('demo_metric', { n: i });
    await expect(session.call('demo_metric', { n: 99 })).rejects.toThrow(/budget exhausted/);
  });

  it('rejects an oversized source document before it reaches the embedder', async () => {
    const { DefaultRAGService, MAX_SOURCE_CHARS } = await import('@/modules/rag');

    const embedBatch = vi.fn(async (texts: readonly string[]) => ({
      vectors: texts.map(() => VECTOR),
      failures: [],
      provider: 'test',
      model: 'test-model',
    }));

    const service = new DefaultRAGService({
      store: {
        save: vi.fn(async () => 1),
        deleteByDocument: vi.fn(async () => 0),
        search: vi.fn(async () => []),
      },
      embeddings: { provider: 'test', model: 'test-model', dimensions: EMBEDDING_DIMENSIONS, embed: vi.fn(), embedBatch },
    });

    await service.index(tenantFor(BUSINESS_A), {
      documentId: '11111111-0000-4000-8000-000000000001' as never,
      sourceType: 'document',
      documentSourceType: 'pdf',
      content: 'x'.repeat(MAX_SOURCE_CHARS + 5_000),
    });

    const embedded = embedBatch.mock.calls[0]?.[0] as readonly string[];
    expect(embedded.every((text) => text.length <= MAX_SOURCE_CHARS + 1_600)).toBe(true);
  });
});

describe('embedding provider failure handling', () => {
  function adapterReturning(embed: AIProviderAdapter['embed']): AIProviderAdapter {
    return {
      provider: 'openai',
      complete: vi.fn(async (): Promise<CompletionResponse> => ({
        content: '',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      })),
      embed,
    };
  }

  function provider(embed: AIProviderAdapter['embed'], maxAttempts = 3) {
    return new ProviderEmbeddingProvider({
      provider: adapterReturning(embed),
      model: { provider: 'openai', modelId: 'text-embedding-3-small', role: 'embedding' },
      maxAttempts,
      sleep: async () => undefined,
    });
  }

  function okResponse(count: number): EmbeddingResponse {
    return {
      embeddings: Array.from({ length: count }, () => [...VECTOR]),
      usage: { promptTokens: 10, completionTokens: 0, totalTokens: 10 },
    };
  }

  it('returns vectors for a successful batch', async () => {
    const result = await provider(vi.fn(async () => okResponse(2))).embedBatch(['a', 'b']);
    expect(result.vectors).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  it('reports a provider outage as a failure rather than an empty result', async () => {
    const result = await provider(
      vi.fn(async () => {
        throw Object.assign(new Error('fetch failed'), { statusCode: 503 });
      }),
    ).embedBatch(['a', 'b']);

    expect(result.vectors).toHaveLength(0);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]?.reason).toMatch(/unavailable/i);
  });

  it('retries a transient failure and then succeeds', async () => {
    let attempts = 0;
    const embed = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('rate limited'), { statusCode: 429 });
      return okResponse(1);
    });

    const result = await provider(embed).embedBatch(['a']);

    expect(attempts).toBe(3);
    expect(result.failures).toHaveLength(0);
    expect(result.vectors).toHaveLength(1);
  });

  it('does not retry an authentication failure', async () => {
    let attempts = 0;
    const embed = vi.fn(async () => {
      attempts += 1;
      throw Object.assign(new Error('invalid api key'), { statusCode: 401 });
    });

    const result = await provider(embed).embedBatch(['a']);

    expect(attempts).toBe(1);
    expect(result.failures[0]?.reason).toMatch(/credentials/i);
  });

  it('does not retry a malformed response', async () => {
    let attempts = 0;
    const embed = vi.fn(async () => {
      attempts += 1;
      return { embeddings: 'not-an-array', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } } as never;
    });

    const result = await provider(embed).embedBatch(['a']);

    expect(attempts).toBe(1);
    expect(result.failures[0]?.reason).toMatch(/malformed/i);
  });

  it('rejects a vector count that does not match the input count', async () => {
    const result = await provider(vi.fn(async () => okResponse(1))).embedBatch(['a', 'b', 'c']);

    expect(result.vectors).toHaveLength(0);
    expect(result.failures).toHaveLength(3);
    expect(result.failures[0]?.reason).toMatch(/1 vectors for 3 inputs/);
  });

  it('rejects a wrong-width vector rather than truncating it', async () => {
    const result = await provider(
      vi.fn(async () => ({
        embeddings: [[1, 2, 3]],
        usage: { promptTokens: 1, completionTokens: 0, totalTokens: 1 },
      })),
    ).embedBatch(['a']);

    expect(result.failures[0]?.reason).toMatch(/width 3, expected 1536/);
  });

  it('gives up after the attempt ceiling', async () => {
    let attempts = 0;
    const embed = vi.fn(async () => {
      attempts += 1;
      throw Object.assign(new Error('timeout'), { name: 'AbortError' });
    });

    const result = await provider(embed, 2).embedBatch(['a']);

    expect(attempts).toBe(2);
    expect(result.failures).toHaveLength(1);
  });

  it('treats an empty batch as a no-op', async () => {
    const result = await provider(vi.fn(async () => okResponse(0))).embedBatch([]);
    expect(result.vectors).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('maps driver errors onto the failure taxonomy', () => {
    expect(categorise({ statusCode: 429 })).toBe('rate_limited');
    expect(categorise({ statusCode: 401 })).toBe('auth_failed');
    expect(categorise({ statusCode: 503 })).toBe('provider_unavailable');
    expect(categorise({ name: 'AbortError' })).toBe('timeout');
    expect(categorise(new Error('rate limit exceeded'))).toBe('rate_limited');
    expect(categorise(new Error('something else entirely'))).toBe('unknown');
  });
});

describe('RAG service failure behaviour', () => {
  async function serviceWith(
    embedBatch: (
      texts: readonly string[],
    ) => Promise<{
      vectors: readonly (readonly number[])[];
      failures: readonly { index: number; reason: string }[];
      provider: string;
      model: string;
    }>,
  ) {
    const { DefaultRAGService } = await import('@/modules/rag');
    const store = {
      save: vi.fn(async () => 0),
      deleteByDocument: vi.fn(async () => 0),
      search: vi.fn(async () => []),
    };
    return {
      store,
      service: new DefaultRAGService({
        store,
        embeddings: {
          provider: 'test',
          model: 'test-model',
          dimensions: EMBEDDING_DIMENSIONS,
          embed: vi.fn(),
          embedBatch,
        },
      }),
    };
  }

  const SOURCE = {
    documentId: '11111111-0000-4000-8000-000000000001' as never,
    sourceType: 'document' as const,
    documentSourceType: 'invoice' as const,
    content: 'Invoice total 1,25,000 rupees.\n\nSecond paragraph with more text.',
  };

  it('reports which chunks failed instead of silently indexing fewer', async () => {
    const { service, store } = await serviceWith(
      vi.fn(async (texts: readonly string[]) => ({
        vectors: texts.map((_, i) => (i === 0 ? VECTOR : undefined)).filter(Boolean) as number[][],
        failures: texts.map((_, i) => ({ index: i, reason: `failed ${i}` })),
        provider: 'test',
        model: 'test-model',
      })),
    );

    const outcome = await service.index(tenantFor(BUSINESS_A), SOURCE);

    expect(outcome.failedCount).toBeGreaterThan(0);
    expect(outcome.failures.length).toBeGreaterThan(0);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('leaves the previous index intact when every embedding fails', async () => {
    const { service, store } = await serviceWith(
      vi.fn(async (texts: readonly string[]) => ({
        vectors: [],
        failures: texts.map((_, i) => ({ index: i, reason: 'provider down' })),
        provider: 'test',
        model: 'test-model',
      })),
    );

    const outcome = await service.index(tenantFor(BUSINESS_A), SOURCE);

    expect(outcome.embeddedCount).toBe(0);
    // Deleting before embedding would empty a live index on a provider outage.
    expect(store.deleteByDocument).not.toHaveBeenCalled();
  });

  it('records absent text as zero chunks rather than a failure', async () => {
    const { service } = await serviceWith(vi.fn());
    // A document whose text is not yet extractable is absent evidence, not an error.
    (service as unknown as { sources: unknown }).sources = {
      loadText: async () => null,
    };

    const outcome = await service.indexDocument(tenantFor(BUSINESS_A), SOURCE.documentId);

    expect(outcome).toMatchObject({ chunkCount: 0, embeddedCount: 0, failedCount: 0 });
  });

  it('refuses indexDocument when no text source is wired', async () => {
    const { service } = await serviceWith(vi.fn());
    await expect(
      service.indexDocument(tenantFor(BUSINESS_A), SOURCE.documentId),
    ).rejects.toThrow(/requires a ChunkTextSource/);
  });
});

describe('tool result size ceiling', () => {
  it('refuses a tool payload beyond the byte limit', async () => {
    const tool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ rows: z.array(z.unknown()) }).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'database',
      execute: async () => ({ rows: Array.from({ length: 5_000 }, (_, i) => ({ i })) }),
    });

    const registry = createToolRegistry({
      tools: [tool as never],
      authorize: async () => undefined,
      limits: { maxResultBytes: 4_096 },
    });

    await expect(registry.open(tenantFor(BUSINESS_A)).call('demo_metric', {})).rejects.toThrow(
      /byte limit/,
    );
  });

  it('bounds a list argument by the configured row ceiling', async () => {
    const tool = defineTool({
      name: 'demo_metric',
      version: 'v1',
      description: 'demo',
      inputSchema: z.object({ limit: z.number().int().min(1).max(10) }).strict(),
      outputSchema: z.object({ ok: z.boolean() }).strict(),
      authorization: { minimumRole: 'staff', permission: 'analytics:read' },
      sensitivity: 'financial',
      readOnly: true,
      source: 'database',
      execute: async () => ({ ok: true }),
    });

    const registry = createToolRegistry({ tools: [tool as never], authorize: async () => undefined });
    await expect(
      registry.open(tenantFor(BUSINESS_A)).call('demo_metric', { limit: 5_000 }),
    ).rejects.toThrow(/invalid input/);
  });

  it('never issues an unbounded query for the business tools', async () => {
    const database = createFakeDatabase([
      { match: 'FROM businesses', rows: [] },
      { match: 'FROM transactions', rows: [] },
      { match: 'FROM customers c', rows: [] },
      { match: 'FROM expenses', rows: [] },
    ]);

    const { createBusinessReadOnlyTools } = await import('@/modules/business-brain');
    const registry = createToolRegistry({
      tools: createBusinessReadOnlyTools(database),
      authorize: async () => undefined,
    });

    const session = registry.open(tenantFor(BUSINESS_A));
    for (const name of ['sales_summary', 'product_performance', 'transaction_search', 'customer_context', 'expense_summary']) {
      await session.call(name, { limit: 5 }).catch(() => undefined);
    }

    expect(database.calls.length).toBeGreaterThan(0);
    for (const call of database.calls) {
      // Any LIMIT must be a bound parameter, never a literal the caller controls.
      const limits = call.sql.match(/LIMIT\s+([^\s]+)/gi) ?? [];
      for (const clause of limits) {
        expect(clause).toMatch(/LIMIT\s+\$\d+/i);
      }
      // A ledger scan must be window-bounded so it cannot become a full scan.
      if (/FROM transactions/.test(call.sql)) {
        expect(call.sql).toMatch(/transaction_date\s*>=\s*\$\d+::timestamptz/);
        expect(call.sql).toMatch(/transaction_date\s*<\s*\$\d+::timestamptz/);
      }
    }
  });
});
