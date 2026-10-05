import { describe, it, expect, vi } from 'vitest';
import {
  ContextAssembler,
  DefaultBusinessBrainService,
  createBusinessReadOnlyTools,
} from '@/modules/business-brain';
import { createToolRegistry } from '@/lib/ai/tools/registry';
import type { AIProviderAdapter, CompletionRequest, CompletionResponse } from '@/lib/ai/providers/types';
import type { ScoredChunk } from '@/modules/rag';
import { BUSINESS_A, createFakeDatabase, tenantFor } from '../helpers/fake-database';

describe('Business Brain — End-to-End Merchant Loop ("Why did my profit fall last month?")', () => {
  it('retrieves revenue, COGS, expenses, RAG, and produces a grounded response with preserved evidence', async () => {
    // 1. Synthetic merchant database answering revenue, expenses, COGS, inventory
    const fakeDb = createFakeDatabase([
      {
        match: 'FROM businesses',
        rows: [{ id: BUSINESS_A, name: 'Sharma Kirana Store', currency: 'INR', status: 'active' }],
      },
      {
        match: 'FROM transactions',
        rows: [
          {
            id: 'tx-1',
            type: 'sale',
            total_minor: 5000000, // 50,000 INR revenue
            tax_minor: 250000,
            status: 'completed',
            recorded_at: '2026-09-15T10:00:00.000Z',
          },
        ],
      },
      {
        match: 'FROM expenses',
        rows: [
          {
            id: 'exp-1',
            category: 'utilities',
            amount_minor: 1500000, // 15,000 INR electricity
            status: 'approved',
            incurred_at: '2026-09-10T10:00:00.000Z',
          },
          {
            id: 'exp-2',
            category: 'rent',
            amount_minor: 2000000, // 20,000 INR rent
            status: 'approved',
            incurred_at: '2026-09-01T10:00:00.000Z',
          },
        ],
      },
      {
        match: 'FROM products',
        rows: [
          {
            id: 'prod-1',
            name: 'Basmati Rice 25kg',
            sku: 'RICE-25',
            cost_price_minor: 220000, // 2,200 INR COGS
            selling_price_minor: 250000,
            current_stock: 40,
          },
        ],
      },
    ]);

    // 2. RAG retriever providing supplier price increase notice
    const mockRetriever = {
      retrieve: vi.fn(async (): Promise<{
        chunks: ScoredChunk[];
        suppressed: { belowThreshold: 0; duplicates: 0; overBudget: 0 };
        retrievedAt: string;
      }> => ({
        chunks: [
          {
            chunk: {
              id: 'chunk-supplier-notice-1',
              documentId: '11111111-0000-4000-8000-000000000001' as never,
              businessId: BUSINESS_A,
              content: 'Notice from ABC Wholesalers: Rice procurement cost increased by 15% starting September due to transportation surcharge.',
              metadata: {
                businessId: BUSINESS_A,
                sourceId: 'doc-supplier',
                sourceType: 'document',
                chunkIndex: 0,
                totalChunks: 1,
                chunkerVersion: 'rag-chunker.v1',
                contentHash: 'hash-notice-1',
                sourceTimestamp: '2026-09-05T00:00:00.000Z',
              },
              createdAt: new Date('2026-09-05T00:00:00.000Z'),
            },
            score: 0.88,
          },
        ],
        suppressed: { belowThreshold: 0, duplicates: 0, overBudget: 0 },
        retrievedAt: '2026-10-01T00:00:00.000Z',
      })),
    };

    // 3. Provider double testing structured completion
    const mockProvider: AIProviderAdapter = {
      provider: 'google',
      complete: vi.fn(async (req: CompletionRequest): Promise<CompletionResponse> => {
        expect(req.systemPrompt).toContain('You are the business analysis system for a small merchant');
        return {
          content: JSON.stringify({ answer: "Whether profit fell last month is not established by the supplied reporting window. Check the recorded supplier notice.", claimType: "interpretation", evidence: JSON.parse(String(req.messages.at(-1)?.content).match(/<citation_registry>([\s\S]*?)<\/citation_registry>/)?.[1] ?? "[]").slice(0, 1), missingInformation: ["comparison period"], conflicts: [], confidence: "low" }),
          usage: { promptTokens: 350, completionTokens: 60, totalTokens: 410 },
          finishReason: 'stop',
          // The resolved id, as a real adapter reports it. The service must
          // record THIS rather than the id it requested.
          model: 'gemini-2.5-pro',
        };
      }),
      embed: vi.fn(),
    };

    const registry = createToolRegistry({
      tools: createBusinessReadOnlyTools(fakeDb),
      authorize: async () => undefined,
    });

    const assembler = new ContextAssembler({
      registry,
      retriever: mockRetriever,
      now: () => new Date('2026-10-01T00:00:00.000Z'),
    });

    const brain = new DefaultBusinessBrainService(assembler, mockProvider);
    const tenantCtx = tenantFor(BUSINESS_A);

    // Act
    const result = await brain.query(tenantCtx, {
      businessId: BUSINESS_A,
      userId: tenantCtx.userId,
      sessionId: 'session-profit-analysis',
      message: 'Why did my profit fall last month?',
    });

    // Assert
    expect(result.message).toContain('profit fell last month');
    expect(['high', 'medium', 'low']).toContain(result.confidence);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.metadata.tokensUsed).toBe(410);
    expect(result.metadata.modelUsed).toBe('gemini-2.5-pro');
    expect(mockProvider.complete).toHaveBeenCalledTimes(1);
    expect(mockRetriever.retrieve).toHaveBeenCalledTimes(1);
  });

  it('exposes uncertainty and falls back cleanly when data is insufficient', async () => {
    // Empty database for new business
    const emptyDb = createFakeDatabase([
      { match: 'FROM businesses', rows: [] },
      { match: 'FROM transactions', rows: [] },
      { match: 'FROM expenses', rows: [] },
      { match: 'FROM products', rows: [] },
    ]);

    const emptyRetriever = {
      retrieve: vi.fn(async () => ({
        chunks: [],
        suppressed: { belowThreshold: 0, duplicates: 0, overBudget: 0 },
        retrievedAt: '2026-10-01T00:00:00.000Z',
      })),
    };

    const registry = createToolRegistry({
      tools: createBusinessReadOnlyTools(emptyDb),
      authorize: async () => undefined,
    });

    const assembler = new ContextAssembler({
      registry,
      retriever: emptyRetriever,
      now: () => new Date('2026-10-01T00:00:00.000Z'),
    });

    // No live provider adapter passed -> deterministic fallback path
    const brain = new DefaultBusinessBrainService(assembler, undefined);
    const tenantCtx = tenantFor(BUSINESS_A);

    const result = await brain.query(tenantCtx, {
      businessId: BUSINESS_A,
      userId: tenantCtx.userId,
      sessionId: 'session-empty',
      message: 'Why did my profit fall last month?',
    });

    expect(result.confidence).toBe('low');
    expect(result.message).toContain('Note:');
    expect(result.metadata.modelUsed).toBe('deterministic-grounding');
  });

  it('wireBusinessBrain supports RAG retriever wiring and executes retrieval', async () => {
    const sessionId = "cccccccc-0000-4000-8000-000000000001";
    const docId = "dddddddd-0000-4000-8000-000000000001";
    const chunkId = "eeeeeeee-0000-4000-8000-000000000001";
    const content = "Supplier surcharge applied to delivery charges";
    const db = createFakeDatabase([
      { match: "SELECT m.id", rows: [] },
      { match: "FROM business_members", rows: [{ role: "owner" }] },
      { match: "SELECT s.id", rows: [{ id: sessionId }] },
      { match: "FROM document_embeddings", rows: [{ content, uploaded_at: "2026-10-01T00:00:00.000Z" }] },
      { match: "FROM businesses", rows: [] },
      { match: "FROM suppliers", rows: [] },
      { match: "INSERT INTO chat_sessions", rows: [] },
      { match: "INSERT INTO chat_messages", rows: [] },
      { match: "UPDATE chat_sessions", rows: [] },
    ]);
    const database = await import("@/lib/database");
    const databaseSpy = vi.spyOn(database, "getDatabaseClient").mockReturnValue(db as never);
    const { wireBusinessBrain } = await import('@/lib/ai/composition');
    const mockRetriever = {
      retrieve: vi.fn(async () => ({
        chunks: [
          {
            chunk: {
              id: chunkId,
              businessId: BUSINESS_A,
              documentId: docId as never,
              sourceId: 'doc-1',
              sourceType: 'invoice' as const,
              content,
              metadata: {
                businessId: BUSINESS_A,
                sourceId: docId,
                sourceType: "invoice",
                sourceTimestamp: "2026-10-01T00:00:00.000Z",
                chunkIndex: 0,
                totalChunks: 1,
                chunkerVersion: 'v1',
                charStart: 0,
                charEnd: 54,
              },
              createdAt: new Date(),
            },
            score: 0.88,
          },
        ],
        suppressed: { belowThreshold: 0, duplicates: 0, overBudget: 0 },
        retrievedAt: new Date().toISOString(),
      })),
    };

    // A local provider double is mandatory even when developer credentials exist.
    const provider: AIProviderAdapter = {
      provider: 'google',
      complete: vi.fn(async (request): Promise<CompletionResponse> => {
        const registry: readonly Record<string, unknown>[] = JSON.parse(String(request.messages.at(-1)?.content).match(/<citation_registry>([\s\S]*?)<\/citation_registry>/)?.[1] ?? '[]');
        const citation = registry.find((item) => String(item.sourceId).startsWith('[E-'));
        return { content: JSON.stringify({ answer: 'Recorded supplier context.', claimType: 'interpretation', evidence: [citation], missingInformation: [], conflicts: [], confidence: 'low' }), usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, finishReason: 'stop' };
      }),
      embed: vi.fn(),
    };
    const { brain } = wireBusinessBrain(BUSINESS_A, { retriever: mockRetriever as never, adapter: provider });
    const tenantCtx = tenantFor(BUSINESS_A);

    const result = await brain.query(tenantCtx, {
      businessId: BUSINESS_A,
      userId: tenantCtx.userId,
      sessionId,
      message: 'Why did my supplier charges increase?',
    });

    expect(mockRetriever.retrieve).toHaveBeenCalledTimes(1);
    expect(result.evidence.some((e) => e.type === 'rag_document')).toBe(true);
    expect(result.metadata.ragContextUsed).toBe(true);
    expect(result.metadata.degradedReason).toBeUndefined();
    expect(result.evidence[0].provenance).toMatchObject({ businessId: BUSINESS_A, userId: tenantCtx.userId, sourceIds: [`[E-${chunkId}]`] });
    databaseSpy.mockRestore();
  });
});
