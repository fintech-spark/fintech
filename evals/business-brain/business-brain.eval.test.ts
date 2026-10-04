import { describe, it, expect } from 'vitest';
import {
  assembleContextPrompt,
  compileContext,
  createBusinessReadOnlyTools,
  isInsufficientEvidence,
} from '@/modules/business-brain';
import { createToolRegistry } from '@/lib/ai/tools/registry';
import type { ScoredChunk } from '@/modules/rag';
import type { ToolEnvelope } from '@/lib/ai/tools/types';
import type { TenantContext } from '@/lib/types';
import { asBusinessId, asUserId } from '@/lib/types';

const BIZ_A = asBusinessId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const BIZ_B = asBusinessId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const USER_A = asUserId('11111111-1111-4111-8111-111111111111');

const OCT_START = '2026-10-01T00:00:00.000Z';
const NOV_START = '2026-11-01T00:00:00.000Z';

function createMockMetricEnvelope(metric: string, valueMinorUnits: number, changeBps: number): ToolEnvelope<unknown> {
  return {
    data: {
      metrics: [
        {
          metric,
          valueMinorUnits,
          currency: 'INR',
          periodStart: OCT_START,
          periodEnd: NOV_START,
          source: 'analytics',
          changeBps,
        },
      ],
      periodStart: OCT_START,
      periodEnd: NOV_START,
    },
    provenance: {
      tool: 'business_overview',
      version: 'v1',
      source: 'analytics',
      sensitivity: 'financial',
      generatedAt: '2026-11-01T00:00:00.000Z',
      reportingPeriod: { start: OCT_START, end: NOV_START },
      tenantScoped: true,
    },
  };
}

function createMockChunk(content: string, id: string, score = 0.85): ScoredChunk {
  return {
    chunk: {
      id,
      businessId: BIZ_A,
      documentId: 'doc-synthetic-1' as never,
      content,
      metadata: {
        businessId: BIZ_A,
        sourceId: 'doc-synthetic-1',
        sourceType: 'document',
        chunkIndex: 0,
        totalChunks: 1,
        chunkerVersion: 'rag-chunker.v1',
      },
      createdAt: new Date('2026-10-15T00:00:00.000Z'),
    },
    score,
  };
}

describe('Business Brain AI Evaluation — Grounding & Hallucination Prevention', () => {
  it('grounds assembled context strictly in authoritative metrics', () => {
    const revenueEnvelope = createMockMetricEnvelope('revenue', 1_500_000, 2000);
    const profitEnvelope = createMockMetricEnvelope('gross_profit', 600_000, 1500);

    const compiled = compileContext({
      question: 'What was my revenue and profit last month?',
      correlationId: 'eval-corr-1',
      toolEnvelopes: [revenueEnvelope, profitEnvelope],
      retrievedChunks: [],
    });

    expect(compiled.context.deterministicMetrics).toHaveLength(2);
    expect(compiled.context.authoritativeFacts).toHaveLength(2);
    expect(compiled.evidence.items.length).toBeGreaterThanOrEqual(2);

    const prompt = assembleContextPrompt(compiled.context, compiled.evidence);
    // Verifies exact deterministic numbers are injected into prompt
    expect(prompt.user).toContain('revenue');
    expect(prompt.user).toContain('1500000');
    expect(prompt.user).toContain('gross_profit');
    expect(prompt.user).toContain('600000');
  });

  it('detects insufficient evidence and flags uncertainty rather than hallucinating', () => {
    const compiled = compileContext({
      question: 'Why did my profit drop in sector Z?',
      correlationId: 'eval-corr-2',
      toolEnvelopes: [],
      retrievedChunks: [],
    });

    expect(isInsufficientEvidence(compiled.context)).toBe(true);
    expect(compiled.context.uncertainties.length).toBeGreaterThan(0);
    expect(compiled.context.uncertainties[0]?.detail).toContain('similarity threshold');
  });

  it('preserves RAG document provenance and citation metadata in evidence packet', () => {
    const chunk = createMockChunk('Supplier increased raw grain cost by 15% due to transportation surcharge.', 'chunk-1');
    const compiled = compileContext({
      question: 'Why did supplier costs rise?',
      correlationId: 'eval-corr-3',
      toolEnvelopes: [],
      retrievedChunks: [chunk],
    });

    expect(compiled.context.retrievedEvidence).toHaveLength(1);
    expect(compiled.context.retrievedEvidence[0]?.content).toContain('raw grain cost');
    expect(compiled.evidence.items.some((i) => i.id.includes('chunk-1'))).toBe(true);

    const prompt = assembleContextPrompt(compiled.context, compiled.evidence);
    expect(prompt.user).toContain('<retrieved_evidence');
    expect(prompt.user).toContain('Supplier increased raw grain cost');
  });

  it('isolates tenants in tool registry and blocks cross-tenant execution', async () => {
    const mockDb = {
      query: async () => [
        {
          id: BIZ_A,
          name: 'Business A',
          display_name: 'Biz A',
          type: 'retail',
          status: 'active',
          industry: 'groceries',
          currency: 'INR',
          timezone: 'Asia/Kolkata',
          fiscal_year_start: 1,
          low_stock_threshold: 5,
          overdue_threshold_days: 30,
        },
      ],
      forTenant: () => mockDb,
    };

    const tools = createBusinessReadOnlyTools(mockDb as never);
    const registry = createToolRegistry({
      tools,
      authorize: async (tenant) => {
        if (tenant.businessId !== BIZ_A) {
          throw new Error('Cross-tenant tool execution is blocked.');
        }
      },
    });

    const tenantCtxA: TenantContext = {
      businessId: BIZ_A,
      userId: USER_A,
      role: 'owner',
      correlationId: 'corr-1',
    };

    const tenantCtxB: TenantContext = {
      businessId: BIZ_B,
      userId: USER_A,
      role: 'owner',
      correlationId: 'corr-2',
    };

    const sessionA = registry.open(tenantCtxA);
    const result = await sessionA.call('business_overview', {});
    expect(result.provenance.tenantScoped).toBe(true);

    const sessionB = registry.open(tenantCtxB);
    await expect(
      sessionB.call('business_overview', {}),
    ).rejects.toThrow('Cross-tenant tool execution is blocked.');
  });
});
