// Merchant Brain: Business Brain grounding and session-isolation contracts.
//
// Three properties, each of which was violated before:
//
//   1. GROUNDING — the assembled evidence region (`prompt.user`: trusted facts,
//      deterministic metrics, retrieved evidence, conflicts, and the wrapped
//      question) must actually reach the provider. It previously did not: the
//      service sent the bare question, so a financial question was answered
//      with no business data and the model filled the gap from imagination.
//   2. SESSION ISOLATION — conversation history is namespaced by tenant AND
//      user. The key used to be the bare sessionId, so two merchants sending
//      "default" shared one history.
//   3. NO SILENT DEGRADATION — a provider failure falls back to the grounded
//      deterministic answer, but the reason is surfaced in the response.

import { describe, it, expect, vi } from 'vitest';
import {
  ContextAssembler,
  DefaultBusinessBrainService,
  createBusinessReadOnlyTools,
} from '@/modules/business-brain';
import { createToolRegistry } from '@/lib/ai/tools/registry';
import type { AIProviderAdapter, CompletionRequest, CompletionResponse } from '@/lib/ai/providers/types';
import type { ScoredChunk } from '@/modules/rag';
import type { TenantContext } from '@/lib/types';
import { BusinessAnswerSchema } from '@/lib/ai/schemas';
import { BUSINESS_A, BUSINESS_B, createFakeDatabase, tenantFor } from '../helpers/fake-database';

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function capturingProvider(captured: CompletionRequest[], impl?: () => Promise<CompletionResponse>) {
  return {
    provider: 'google' as const,
    complete: vi.fn(async (request: CompletionRequest) => {
      captured.push(request);
      if (impl) return impl();
      return { content: 'stub answer', usage, finishReason: 'stop' as const };
    }),
    embed: vi.fn(),
  } satisfies AIProviderAdapter;
}

const emptyRetriever = {
  retrieve: vi.fn(async () => ({
    chunks: [] as ScoredChunk[],
    suppressed: { belowThreshold: 0, duplicates: 0, overBudget: 0 },
    retrievedAt: '2026-10-01T00:00:00.000Z',
  })),
};

function buildBrain(
  provider: AIProviderAdapter,
  rows: readonly Record<string, unknown>[] = [],
): DefaultBusinessBrainService {
  const fakeDb = createFakeDatabase([
    { match: 'FROM businesses', rows: [{ id: BUSINESS_A, name: 'Store', currency: 'INR', status: 'active' }] },
    ...(rows.length > 0 ? [{ match: 'FROM transactions', rows }] : []),
  ]);
  const registry = createToolRegistry({
    tools: createBusinessReadOnlyTools(fakeDb),
    authorize: async () => undefined,
  });
  const assembler = new ContextAssembler({
    registry,
    retriever: emptyRetriever,
    now: () => new Date('2026-10-01T00:00:00.000Z'),
  });
  return new DefaultBusinessBrainService(assembler, provider);
}

describe('Business Brain — grounding contract', () => {
  it('sends the assembled evidence region to the provider, not just the question', async () => {
    const captured: CompletionRequest[] = [];
    const brain = buildBrain(
      capturingProvider(captured),
      [
        {
          id: 'tx-1',
          type: 'sale',
          total_minor: 5000000,
          status: 'completed',
          recorded_at: '2026-09-15T10:00:00.000Z',
        },
      ],
    );

    await brain.query(tenantFor(BUSINESS_A), {
      businessId: BUSINESS_A,
      userId: tenantFor(BUSINESS_A).userId,
      message: 'Why did my profit fall last month?',
      sessionId: 's1',
    } as never);

    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(request.schema).toBe(BusinessAnswerSchema);
    expect(request.responseFormat).toBe('json');
    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === 'user');
    const content = String(lastUserMessage?.content ?? '');

    // The merchant question must arrive inside a delimiter-wrapped region...
    expect(content).toContain('<merchant_question>');
    expect(content).toContain('Why did my profit fall last month?');

    // ...and at least one evidence region must have travelled with it. Before
    // the fix the entire user turn was the bare 34-character question, so no
    // region tag could be present.
    const REGIONS = [
      '<trusted_facts>',
      '<deterministic_metrics>',
      '<retrieved_evidence>',
      '<uncertainties>',
      '<conflicts>',
    ];
    expect(REGIONS.some((tag) => content.includes(tag))).toBe(true);

    // Never bare text that could read as an instruction.
    expect(content).not.toBe('Why did my profit fall last month?');
  });

  it('still passes the system prompt with the citable-id list', async () => {
    const captured: CompletionRequest[] = [];
    const brain = buildBrain(capturingProvider(captured));
    await brain.query(tenantFor(BUSINESS_A), {
      businessId: BUSINESS_A,
      userId: tenantFor(BUSINESS_A).userId,
      message: 'How is my business doing?',
    } as never);

    expect(captured[0].systemPrompt).toContain('ABSOLUTE RULES');
    expect(captured[0].systemPrompt).toContain('PERMITTED EVIDENCE IDS');
  });
});

describe('Business Brain — session isolation', () => {
  it('does not leak conversation history between tenants using the same sessionId', async () => {
    const brain = buildBrain(capturingProvider([]));

    const ctxA = tenantFor(BUSINESS_A);
    const ctxB: TenantContext = { ...tenantFor(BUSINESS_B), userId: 'dddddddd-0000-4000-8000-00000000000d' as never };

    await brain.query(ctxA, { businessId: BUSINESS_A, userId: ctxA.userId, message: 'secret A question', sessionId: 'default' } as never);
    await brain.query(ctxB, { businessId: BUSINESS_B, userId: ctxB.userId, message: 'secret B question', sessionId: 'default' } as never);

    const historyA = await brain.getSessionHistory(ctxA, 'default');
    const historyB = await brain.getSessionHistory(ctxB, 'default');

    const textA = historyA.messages.map((m) => m.content).join(' ');
    const textB = historyB.messages.map((m) => m.content).join(' ');

    expect(textA).toContain('secret A question');
    expect(textA).not.toContain('secret B question');
    expect(textB).toContain('secret B question');
    expect(textB).not.toContain('secret A question');
  });

  it('keeps separate sessions for different users in the same tenant', async () => {
    const brain = buildBrain(capturingProvider([]));
    const owner = tenantFor(BUSINESS_A);
    const staff: TenantContext = { ...owner, userId: 'eeeeeeee-0000-4000-8000-00000000000e' as never, role: 'staff' };

    await brain.query(owner, { businessId: BUSINESS_A, userId: owner.userId, message: 'owner question', sessionId: 'default' } as never);

    const staffHistory = await brain.getSessionHistory(staff, 'default');
    expect(staffHistory.messages).toHaveLength(0);
  });
});

describe('Business Brain — provider failure is surfaced, not swallowed', () => {
  it('falls back to the grounded answer and reports the degradation', async () => {
    const captured: CompletionRequest[] = [];
    const brain = buildBrain(
      capturingProvider(captured, async () => {
        throw new Error('provider exploded');
      }),
      [
        {
          id: 'tx-1',
          type: 'sale',
          total_minor: 5000000,
          status: 'completed',
          recorded_at: '2026-09-15T10:00:00.000Z',
        },
      ],
    );

    const ctx = tenantFor(BUSINESS_A);
    const result = await brain.query(ctx, {
      businessId: BUSINESS_A,
      userId: ctx.userId,
      message: 'Why did my profit fall last month?',
    } as never);

    expect(result.metadata.degradedReason).toContain('provider exploded');
    expect(result.metadata.modelUsed).toBe('deterministic-grounding');
    // The fallback is real data, never the model's output and never filler.
    expect(result.message).not.toBe('stub answer');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('does not report degradation on the happy path', async () => {
    const brain = buildBrain(capturingProvider([]));
    const ctx = tenantFor(BUSINESS_A);
    const result = await brain.query(ctx, {
      businessId: BUSINESS_A,
      userId: ctx.userId,
      message: 'How is my business doing?',
    } as never);

    expect(result.metadata.degradedReason).toBeUndefined();
  });
});
