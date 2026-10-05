// Merchant Brain: hybrid context assembly
//
// This is the seam the whole phase exists to build: structured retrieval and
// semantic retrieval feeding one evidence packet.
//
//   question
//     -> plan which read-only tools apply
//     -> run them against the authenticated tenant, under a call budget
//     -> retrieve tenant-scoped document evidence
//     -> compile one AIContext that keeps the two apart
//     -> assemble an evidence-bound prompt
//
// ORDERING NOTE
// -------------
// Tool execution is sequential and budgeted rather than parallel-and-truncated.
// The context compiler already caps how many tool results survive, so running
// eleven tools to keep five would spend the budget on data that is then thrown
// away. `planToolCalls` decides what is worth asking for before anything runs.
//
// NO MODEL IN THE LOOP
// --------------------
// Tool selection here is deterministic pattern matching on the question, not a
// model deciding what to call. That is a deliberate constraint for this phase: a
// model-chosen tool plan is a privilege-escalation surface, and the deterministic
// matcher is testable. A future phase can add a planner, behind the same
// allowlisted registry, without changing anything below.

import type { TenantContext } from '@/lib/types';
import type { ToolRegistry, ToolSession } from '@/lib/ai/tools/registry';
import type { ToolEnvelope } from '@/lib/ai/tools/types';
import type { ChunkSourceType, RagRetriever, RetrievalResult } from '@/modules/rag';
import type { RetrievalPolicy } from '@/modules/rag';
import { assessFreshness } from '@/modules/rag';
import type { AIContext } from '../domain/context';
import type { EvidencePacket } from '../domain/evidence';
import type { ToolCallRecord } from '../domain/types';
import { compileContext } from './context-compiler';
import type { CompileOutput } from './context-compiler';
import { assembleContextPrompt } from './prompt-builder';
import type { AssembledPrompt } from './prompt-builder';
import type { ContextBudget } from './context-compiler';

export interface AssemblyRequest {
  readonly question: string;
  /** Optional explicit plan. When absent, `planToolCalls` derives one. */
  readonly toolCalls?: readonly { readonly tool: string; readonly input: unknown }[];
  readonly retrieval?: {
    readonly enabled?: boolean;
    readonly topK?: number;
    readonly sourceTypes?: readonly ChunkSourceType[];
  };
}

export interface AssemblyResult {
  readonly toolRecords?: readonly ToolCallRecord[];
  readonly context: AIContext;
  readonly evidence: EvidencePacket;
  readonly prompt: AssembledPrompt;
  /** Tools that were planned and attempted, with the failure that stopped them. */
  readonly toolFailures: readonly { readonly tool: string; readonly reason: string }[];
}

export interface AssemblerDependencies {
  readonly authorizeEvidence?: (ctx: TenantContext, compiled: CompileOutput) => Promise<CompileOutput>;
  readonly registry: ToolRegistry;
  readonly retriever?: RagRetriever;
  readonly retrievalPolicy?: RetrievalPolicy;
  readonly budget?: Partial<ContextBudget>;
  readonly now?: () => Date;
}

/**
 * Intent patterns for the deterministic planner.
 *
 * Intentionally conservative: an unmatched question gets the overview tool and
 * retrieval, not every tool. Over-fetching is not free — it costs a database
 * round trip and spends the call budget that a follow-up question needs.
 */
const TOOL_INTENTS: readonly { readonly tool: string; readonly pattern: RegExp }[] = [
  { tool: 'sales_summary', pattern: /sale|revenue|turnover|income|earn|drop|fell|down|up|growth|trend|month|period|performance/i },
  { tool: 'product_performance', pattern: /product|item|sku|best|worst|top|which product|margin|profit/i },
  { tool: 'inventory_status', pattern: /inventory|stock|out of stock|reorder|restock|low stock|supply/i },
  { tool: 'customer_context', pattern: /customer|client|buyer|khata|receivable|owe|owing|credit/i },
  { tool: 'supplier_context', pattern: /supplier|vendor|purchase order|procurement|payable|cost increase/i },
  { tool: 'expense_summary', pattern: /expense|spend|cost|overhead|rent|salary|bill/i },
  { tool: 'cash_flow_summary', pattern: /cash flow|cash position|liquidity|runway|payroll|shortfall/i },
  { tool: 'profit_leak_findings', pattern: /leak|losing money|profit leak|bleed|where.*money/i },
  { tool: 'transaction_search', pattern: /transaction|receipt record|particular transaction|find transaction/i },
];

/** Always included: grounds currency and reporting-calendar questions. */
const ALWAYS_TOOLS = ['business_overview'] as const;

/**
 * Derives a bounded tool plan from the question text.
 *
 * Returns at most `maxCalls` names so the plan can never exceed the registry's
 * own budget. `business_overview` is not counted against the cap: it is a single
 * row read and it makes every answer interpretable.
 */
export function planToolCalls(
  question: string,
  options: { readonly maxCalls?: number; readonly explicit?: readonly string[] } = {},
): string[] {
  const maxCalls = options.maxCalls ?? 5;
  const planned: string[] = [];

  for (const name of options.explicit ?? []) {
    if (!planned.includes(name)) planned.push(name);
  }

  if (planned.length === 0) {
    for (const intent of TOOL_INTENTS) {
      if (intent.pattern.test(question)) planned.push(intent.tool);
      if (planned.length >= maxCalls) break;
    }
  }

  const withoutOverview = planned.slice(0, maxCalls);
  return [...ALWAYS_TOOLS.filter((name) => !withoutOverview.includes(name)), ...withoutOverview];
}

export class ContextAssembler {
  private readonly authorizeEvidence: AssemblerDependencies['authorizeEvidence'];
  private readonly registry: ToolRegistry;
  private readonly retriever: RagRetriever | undefined;
  private readonly retrievalPolicy: RetrievalPolicy | undefined;
  private readonly budget: Partial<ContextBudget> | undefined;
  private readonly now: () => Date;

  constructor(dependencies: AssemblerDependencies) {
    this.authorizeEvidence = dependencies.authorizeEvidence;
    this.registry = dependencies.registry;
    this.retriever = dependencies.retriever;
    this.retrievalPolicy = dependencies.retrievalPolicy;
    this.budget = dependencies.budget;
    this.now = dependencies.now ?? (() => new Date());
  }

  async assemble(ctx: TenantContext, request: AssemblyRequest): Promise<AssemblyResult> {
    const toolFailures: { tool: string; reason: string }[] = [];
    const session: ToolSession = this.registry.open(ctx);

    const plan = request.toolCalls ?? this.planFrom(request.question);
    const envelopes: ToolEnvelope<unknown>[] = [];
    const toolRecords: ToolCallRecord[] = [];

    for (const call of plan) {
      try {
        const started = this.now().getTime();
        const envelope = await session.call(call.tool, call.input);
        envelopes.push(envelope);
        toolRecords.push({ toolName: call.tool, input: call.input && typeof call.input === "object" && !Array.isArray(call.input) ? call.input as Record<string, unknown> : {}, output: { source: envelope.provenance.source, version: envelope.provenance.version }, latencyMs: Math.max(0, this.now().getTime() - started) });
      } catch (error) {
        // A failed tool degrades the answer; it does not fail the request. The
        // reason is recorded so the compiler can tell the model that evidence
        // is missing rather than absent.
        toolFailures.push({ tool: call.tool, reason: describeFailure(error) });
      }
    }

    const retrievalEnabled = request.retrieval?.enabled ?? this.retriever !== undefined;
    const retrieval = retrievalEnabled
      ? await this.retrieve(ctx, request, toolFailures)
      : undefined;
    const chunks = (retrieval?.chunks ?? []).filter((item) => item.chunk.businessId === ctx.businessId && item.chunk.metadata.businessId === ctx.businessId);
    const freshness =
      chunks.length > 0 ? assessFreshness(chunks, this.retrievalPolicy, this.now()) : undefined;

    let compiled = compileContext({
      question: request.question,
      correlationId: ctx.correlationId,
      toolEnvelopes: envelopes,
      retrievedChunks: chunks,
      ...(freshness ? { freshness } : {}),
      retrievalSuppressed: {
        belowThreshold: retrieval?.suppressed.belowThreshold ?? 0,
        duplicates: retrieval?.suppressed.duplicates ?? 0,
        overBudget: (retrieval?.suppressed.overBudget ?? 0) + toolFailures.length,
      },
      toolCallCount: session.callCount,
      ...(this.budget ? { budget: this.budget } : {}),
      now: this.now(),
    });

    if (this.authorizeEvidence) compiled = await this.authorizeEvidence(ctx, compiled);

    const withFailures = appendToolFailures(compiled.context, toolFailures);

    return {
      toolRecords,
      context: withFailures,
      evidence: compiled.evidence,
      prompt: assembleContextPrompt(withFailures, compiled.evidence),
      toolFailures,
    };
  }

  private planFrom(question: string) {
    const names = planToolCalls(question, { maxCalls: Math.min(5, this.registry.limits.maxToolCalls) });
    return names
      .filter((name) => this.registry.has(name))
      .map((name) => ({ tool: name, input: {} }));
  }

  private async retrieve(
    ctx: TenantContext,
    request: AssemblyRequest,
    toolFailures: { tool: string; reason: string }[],
  ): Promise<RetrievalResult | undefined> {
    if (!this.retriever) return undefined;
    try {
      return await this.retriever.retrieve(ctx, {
        queryText: request.question,
        ...(request.retrieval?.topK !== undefined ? { topK: request.retrieval.topK } : {}),
        ...(request.retrieval?.sourceTypes ? { sourceTypes: request.retrieval.sourceTypes } : {}),
      });
    } catch (error) {
      toolFailures.push({ tool: 'rag_retrieval', reason: describeFailure(error) });
      return undefined;
    }
  }
}

/** Retrieval failure is an absence the model must be told about. */
function appendToolFailures(
  context: AIContext,
  failures: readonly { tool: string; reason: string }[],
): AIContext {
  if (failures.length === 0) return context;
  return {
    ...context,
    uncertainties: [
      ...context.uncertainties,
      ...failures.map((failure) => ({
        id: `U-tool-${failure.tool}`,
        subject: failure.tool,
        reason: 'tool_failed' as const,
        detail: `${failure.tool} could not be evaluated (${failure.reason}). Any figure it would have supplied is unavailable. Do not estimate it.`,
      })),
    ],
  };
}

function describeFailure(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}
