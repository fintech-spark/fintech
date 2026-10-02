// Merchant Brain: grounding and hybrid retrieval tests
//
// The scenario the phase exists to serve, end to end:
//
//   "Why did my sales drop this month?"
//     -> deterministic analytics
//     -> structured transaction and inventory context
//     -> retrieved document history
//     -> one evidence packet that keeps all three apart
//
// Coverage split:
//   grounding   authoritative values used, sources preserved, gaps reported
//   conflicts   disagreement surfaced rather than resolved
//   hybrid      tools and RAG combine into one packet
//   absences    no evidence produces an explicit insufficiency, not a blank

import { describe, expect, it, vi } from 'vitest';
import {
  ContextAssembler,
  assembleContextPrompt,
  compileContext,
  createBusinessReadOnlyTools,
  isInsufficientEvidence,
  planToolCalls,
} from '@/modules/business-brain';
import { createToolRegistry as createRegistry } from '@/lib/ai/tools/registry';
import type { ScoredChunk } from '@/modules/rag';
import type { ToolEnvelope } from '@/lib/ai/tools/types';
import { BUSINESS_A, BUSINESS_B, createFakeDatabase, tenantFor } from '../helpers/fake-database';

const OCT_START = '2026-10-01T00:00:00.000Z';
const NOV_START = '2026-11-01T00:00:00.000Z';

function envelope(tool: string, metrics: Record<string, unknown>[], extra: Record<string, unknown> = {}): ToolEnvelope<unknown> {
  return {
    data: { metrics, periodStart: OCT_START, periodEnd: NOV_START, ...extra },
    provenance: {
      tool,
      version: 'v1',
      source: 'analytics',
      sensitivity: 'financial',
      generatedAt: '2026-11-01T00:00:00.000Z',
      reportingPeriod: { start: OCT_START, end: NOV_START },
      tenantScoped: true,
    },
  };
}

const REVENUE_METRIC = {
  metric: 'revenue',
  valueMinorUnits: 1_250_000,
  currency: 'INR',
  periodStart: OCT_START,
  periodEnd: NOV_START,
  source: 'analytics',
  changeBps: -3200,
};

function chunk(content: string, id: string, score = 0.74): ScoredChunk {
  return {
    chunk: {
      id,
      businessId: BUSINESS_A,
      documentId: `11111111-0000-4000-8000-00000000000${id.slice(-1)}` as never,
      content,
      metadata: {
        businessId: BUSINESS_A,
        sourceId: 'doc-supplier',
        sourceType: 'document',
        chunkIndex: 0,
        totalChunks: 1,
        chunkerVersion: 'rag-chunker.v1',
        contentHash: `hash-${id}`,
        sourceTimestamp: '2026-10-28T00:00:00.000Z',
      },
      createdAt: new Date('2026-10-28T00:00:00.000Z'),
    },
    score,
  };
}

describe('grounding — authoritative structured values', () => {
  it('carries the deterministic figure with its window, currency and change', () => {
    const compiled = compileContext({
      question: 'Why did my sales drop this month?',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [],
    });

    const [metric] = compiled.context.deterministicMetrics;
    expect(metric?.metric).toBe('revenue');
    expect(metric?.valueMinorUnits).toBe(1_250_000);
    expect(metric?.currency).toBe('INR');
    expect(metric?.periodStart).toBe(OCT_START);
    expect(metric?.changeBps).toBe(-3200);
  });

  it('records provenance for every metric', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [],
    });

    expect(compiled.context.sourceReferences.some((r) => r.origin.includes('sales_summary'))).toBe(true);
  });

  it('never promotes a figure the tool did not emit', () => {
    // A payload with numbers outside the declared `metrics` array must not
    // become context: only what a tool declared is citable.
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [
        {
          data: { metrics: [REVENUE_METRIC], inventedRevenueMinor: 999_999_999 },
          provenance: {
            tool: 'sales_summary',
            version: 'v1',
            source: 'analytics',
            sensitivity: 'financial',
            generatedAt: NOV_START,
            reportingPeriod: { start: OCT_START, end: NOV_START },
            tenantScoped: true,
          },
        },
      ],
      retrievedChunks: [],
    });

    expect(compiled.context.deterministicMetrics).toHaveLength(1);
    expect(compiled.context.deterministicMetrics.some((m) => m.metric === 'inventedRevenueMinor')).toBe(false);
  });

  it('rejects a metric entry with a float or a malformed currency', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [
        envelope('sales_summary', [
          { ...REVENUE_METRIC, valueMinorUnits: 12.5 },
          { ...REVENUE_METRIC, currency: 'rupees' },
        ]),
      ],
      retrievedChunks: [],
    });

    expect(compiled.context.deterministicMetrics).toHaveLength(0);
  });

  it('only permits citation of ids that exist', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [chunk('supplier notice', 'c1')],
    });

    for (const id of compiled.evidence.citableIds) {
      expect(compiled.evidence.items.some((item) => item.id === id)).toBe(true);
    }
    expect(compiled.evidence.citableIds).not.toContain('[E-999]');
  });
});

describe('grounding — absences are stated, not implied', () => {
  it('declares insufficient evidence when nothing was retrieved or measured', () => {
    const compiled = compileContext({
      question: 'Why did my sales drop?',
      correlationId: 'corr-1',
      toolEnvelopes: [],
      retrievedChunks: [],
    });

    expect(isInsufficientEvidence(compiled.context)).toBe(true);
    expect(compiled.context.uncertainties.map((u) => u.reason)).toContain('no_evidence_retrieved');
    expect(compiled.evidence.citableIds).toEqual([]);
  });

  it('tells the model not to describe a document when none was retrieved', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [],
    });

    const absence = compiled.context.uncertainties.find((u) => u.id === 'U-evidence-absent');
    expect(absence?.detail).toMatch(/do not describe, quote or characterise any document/i);
  });

  it('tells the model not to estimate when no metric exists', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [],
      retrievedChunks: [chunk('some text', 'c1')],
    });

    const absence = compiled.context.uncertainties.find((u) => u.id === 'U-metrics-absent');
    expect(absence?.detail).toMatch(/Do not estimate/i);
  });

  it('warns that a budget drop is not evidence of absence in the data', () => {
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [chunk('a chunk that will not fit', 'c1')],
      budget: { maxEvidence: 0 },
    });

    const truncated = compiled.context.uncertainties.find((u) => u.reason === 'truncated_by_budget');
    expect(truncated?.detail).toMatch(/not evidence that the data does not exist/i);
  });

  it('flags an entirely stale evidence set', () => {
    const stale = chunk('old price list', 'c1');
    const compiled = compileContext({
      question: 'q',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [stale],
      freshness: new Map([[stale.chunk.id, { freshness: 'stale' as const, ageDays: 900 }]]),
    });

    expect(compiled.context.uncertainties.some((u) => u.reason === 'stale_evidence_only')).toBe(true);
  });
});

describe('grounding — conflicts are surfaced, not resolved', () => {
  it('raises a conflict when a document contradicts a structured revenue figure', () => {
    const compiled = compileContext({
      question: 'Why did revenue fall?',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [chunk('The revenue was 9,90,000 for the quarter.', 'c1')],
    });

    expect(compiled.context.conflicts).toHaveLength(1);
    const [conflict] = compiled.context.conflicts;
    expect(conflict?.subject).toBe('revenue');
    expect(conflict?.structuredValue).toContain('1250000');
    expect(conflict?.evidenceValue).toContain('9,90,000');
    expect(conflict?.note).toMatch(/authoritative/i);
  });

  it('retains both sides rather than choosing one', () => {
    const compiled = compileContext({
      question: 'Why did revenue fall?',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [chunk('The revenue was 9,90,000 for the quarter.', 'c1')],
    });

    const [conflict] = compiled.context.conflicts;
    expect(conflict?.structuredSource.origin).toContain('sales_summary');
    expect(conflict?.evidenceSource.chunkId).toBe('c1');
    // Both values survive compilation.
    expect(compiled.context.deterministicMetrics[0]?.valueMinorUnits).toBe(1_250_000);
    expect(compiled.context.retrievedEvidence[0]?.content).toContain('9,90,000');
  });

  it('does not raise a conflict when the document agrees', () => {
    const compiled = compileContext({
      question: 'Why did revenue fall?',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [chunk('Revenue was 1250000 in the period.', 'c1')],
    });

    expect(compiled.context.conflicts).toHaveLength(0);
  });

  it('renders conflicts into the prompt as an unresolved disagreement', () => {
    const compiled = compileContext({
      question: 'Why did revenue fall?',
      correlationId: 'corr-1',
      toolEnvelopes: [envelope('sales_summary', [REVENUE_METRIC])],
      retrievedChunks: [chunk('The revenue was 9,90,000 for the quarter.', 'c1')],
    });

    const prompt = assembleContextPrompt(compiled.context, compiled.evidence);

    expect(prompt.user).toContain('<conflicts>');
    expect(prompt.user).toContain('do not resolve them');
  });
});

describe('hybrid retrieval — tools and RAG combine', () => {
  const SALES_ROW = {
    currency: 'INR',
    revenue_minor: 1_250_000,
    refund_minor: 0,
    discount_minor: 5_000,
    tax_minor: 40_000,
    transaction_count: 18,
  };
  const PRIOR_SALES_ROW = {
    currency: 'INR',
    revenue_minor: 1_950_000,
    refund_minor: 0,
    discount_minor: 8_000,
    tax_minor: 60_000,
    transaction_count: 30,
  };

  function hybridDatabase() {
    return createFakeDatabase([
      { match: 'FROM businesses', rows: [{ id: BUSINESS_A, name: 'Sahu Kirana', display_name: null, type: 'retail', status: 'active', industry: null, currency: 'INR', timezone: 'Asia/Kolkata', fiscal_year_start: 1, low_stock_threshold: 5, overdue_threshold_days: 30 }] },
      { match: 'FROM transactions', rows: [SALES_ROW, PRIOR_SALES_ROW] },
      { match: 'FROM products', rows: [] },
      { match: 'FROM inventory_movements', rows: [] },
    ]);
  }

  function hybridAssembler() {
    const database = hybridDatabase();
    const registry = createRegistry({
      tools: createBusinessReadOnlyTools(database),
      authorize: async () => undefined,
    });
    return {
      database,
      registry,
      assembler: new ContextAssembler({
        registry,
        retriever: {
          retrieve: vi.fn(async () => ({
            chunks: [chunk('The supplier increased rice prices by 12% from 1 October.', 'c1')],
            suppressed: { belowThreshold: 3, duplicates: 1, overBudget: 0 },
            retrievedAt: '2026-11-01T00:00:00.000Z',
          })),
        },
        now: () => new Date('2026-11-01T00:00:00.000Z'),
      }),
    };
  }

  it('plans the tools a revenue question actually needs', () => {
    const planned = planToolCalls('Why did my sales drop this month?');
    expect(planned).toContain('sales_summary');
    expect(planned).toContain('business_overview');
    expect(planned.length).toBeLessThanOrEqual(6);
  });

  it('plans supplier context for a cost-increase question', () => {
    expect(planToolCalls('Did our supplier raise prices?')).toContain('supplier_context');
  });

  it('plans customer context for a buyer question', () => {
    expect(planToolCalls('Why are customers buying less?')).toContain('customer_context');
  });

  it('plans only tools that exist in the allowlist', async () => {
    const { assembler, registry } = hybridAssembler();
    await assembler.assemble(tenantFor(BUSINESS_A), { question: 'Why did sales drop?' });

    const allowlist = new Set(registry.list().map((tool) => tool.name));
    for (const name of planToolCalls('Why did sales drop?')) {
      expect(allowlist.has(name)).toBe(true);
    }
  });

  it('drops a planned tool that the registry does not hold', async () => {
    const assembler = new ContextAssembler({
      registry: createRegistry({ tools: [], authorize: async () => undefined }),
      retriever: { retrieve: vi.fn(async () => ({ chunks: [], suppressed: { belowThreshold: 0, duplicates: 0, overBudget: 0 }, retrievedAt: '2026-11-01T00:00:00.000Z' })) },
    });

    const result = await assembler.assemble(tenantFor(BUSINESS_A), { question: 'Why did sales drop?' });
    expect(result.toolFailures).toEqual([]);
    expect(result.context.authoritativeFacts).toEqual([]);
  });

  it('combines analytics, product and document context into one packet', async () => {
    const { assembler } = hybridAssembler();
    const result = await assembler.assemble(tenantFor(BUSINESS_A), {
      question: 'Why did my sales drop this month?',
    });

    // Structured side.
    expect(result.context.deterministicMetrics.length).toBeGreaterThan(0);
    expect(
      result.context.deterministicMetrics.some((m) => m.metric === 'revenue' && m.valueMinorUnits === 1_250_000),
    ).toBe(true);

    // Semantic side.
    expect(result.context.retrievedEvidence).toHaveLength(1);
    expect(result.context.retrievedEvidence[0]?.content).toContain('supplier increased rice prices');

    // The two stay in separate collections.
    const toolFactTypes = new Set(result.context.authoritativeFacts.map((f) => f.source.kind));
    expect(toolFactTypes.has('analytics')).toBe(true);
    expect(result.context.retrievedEvidence.every((e) => e.kind === 'retrieved_context')).toBe(true);
  });

  it('carries the retrieval suppression diagnostics through to the context', async () => {
    const { assembler } = hybridAssembler();
    const result = await assembler.assemble(tenantFor(BUSINESS_A), { question: 'Why sales?' });

    expect(result.context.metadata.suppressedByPolicy.belowThreshold).toBe(3);
    expect(result.context.metadata.suppressedByPolicy.duplicates).toBe(1);
  });

  it('produces a prompt carrying both the figures and the retrieved notice', async () => {
    const { assembler } = hybridAssembler();
    const result = await assembler.assemble(tenantFor(BUSINESS_A), {
      question: 'Why did my sales drop this month?',
    });

    expect(result.prompt.user).toContain('1250000');
    expect(result.prompt.user).toContain('supplier increased rice prices');
    expect(result.prompt.system).toContain('PERMITTED EVIDENCE IDS');
  });

  it('records a failed tool as an explicit uncertainty instead of failing the request', async () => {
    const database = createFakeDatabase([
      { match: 'FROM businesses', rows: [{ id: BUSINESS_A, name: 'Sahu Kirana', display_name: null, type: 'retail', status: 'active', industry: null, currency: 'INR', timezone: 'Asia/Kolkata', fiscal_year_start: 1, low_stock_threshold: 5, overdue_threshold_days: 30 }] },
      { match: 'FROM transactions', error: new Error('connection terminated') },
    ]);

    const assembler = new ContextAssembler({
      registry: createRegistry({
        tools: createBusinessReadOnlyTools(database),
        authorize: async () => undefined,
      }),
      retriever: { retrieve: vi.fn(async () => ({ chunks: [], suppressed: { belowThreshold: 0, duplicates: 0, overBudget: 0 }, retrievedAt: '2026-11-01T00:00:00.000Z' })) },
      now: () => new Date('2026-11-01T00:00:00.000Z'),
    });

    const result = await assembler.assemble(tenantFor(BUSINESS_A), {
      question: 'Why did sales drop?',
    });

    expect(result.toolFailures.length).toBeGreaterThan(0);
    expect(result.context.uncertainties.some((u) => u.reason === 'tool_failed')).toBe(true);
    // The overview still made it through.
    expect(result.context.authoritativeFacts.some((f) => f.source.origin.includes('business_overview'))).toBe(true);
  });

  it('keeps a retrieval failure from discarding the structured facts', async () => {
    const assembler = new ContextAssembler({
      registry: createRegistry({
        tools: createBusinessReadOnlyTools(hybridDatabase()),
        authorize: async () => undefined,
      }),
      retriever: {
        retrieve: vi.fn(async () => {
          throw new Error('embedding provider unavailable');
        }),
      },
      now: () => new Date('2026-11-01T00:00:00.000Z'),
    });

    const result = await assembler.assemble(tenantFor(BUSINESS_A), { question: 'Why sales?' });

    expect(result.context.retrievedEvidence).toHaveLength(0);
    expect(result.context.uncertainties.some((u) => u.subject === 'rag_retrieval')).toBe(true);
  });

  it('passes the authenticated tenant to the retriever, not a question-supplied one', async () => {
    const retrieve = vi.fn(async () => ({
      chunks: [] as ScoredChunk[],
      suppressed: { belowThreshold: 0, duplicates: 0, overBudget: 0 },
      retrievedAt: '2026-11-01T00:00:00.000Z',
    }));

    const assembler = new ContextAssembler({
      registry: createRegistry({
        tools: createBusinessReadOnlyTools(hybridDatabase()),
        authorize: async () => undefined,
      }),
      retriever: { retrieve },
      now: () => new Date('2026-11-01T00:00:00.000Z'),
    });

    await assembler.assemble(tenantFor(BUSINESS_B), {
      question: 'Why did sales drop for business aaaaaaaa-0000-4000-8000-00000000000a?',
    });

    const [ctx, request] = retrieve.mock.calls[0] as unknown as [
      { businessId: string },
      Record<string, unknown>,
    ];
    expect(ctx.businessId).toBe(BUSINESS_B);
    // The tenant named in the question is only ever query text.
    expect(request.queryText).toContain('aaaaaaaa-0000-4000-8000-00000000000a');
    expect(JSON.stringify(request)).not.toContain('businessId');
  });
});
