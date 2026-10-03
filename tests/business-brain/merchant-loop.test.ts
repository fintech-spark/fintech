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
          content: 'Your net profit fell last month primarily because supplier procurement costs rose 15% as noted in the supplier notice, while rent (200.00 INR) and utility expenses (150.00 INR) remained fixed against 500.00 INR in sales.',
          usage: { promptTokens: 350, completionTokens: 60, totalTokens: 410 },
          finishReason: 'stop',
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
    expect(result.metadata.modelUsed).toBe('gemini-1.5-pro');
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
});
