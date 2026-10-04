import type { TenantContext } from "@/lib/types";
import type {
  BrainQuery,
  BrainResponse,
  ConversationMessage,
  EvidenceReference,
  ToolCallRecord,
} from "../domain/types";
import type { ContextAssembler, AssemblyResult } from "./context-assembler";
import type { AIProviderAdapter, ModelConfig } from "@/lib/ai/providers/types";
import type { Clock } from "@/lib/clock";
import { systemClock } from "@/lib/clock";
import { BusinessAnswerSchema } from "@/lib/ai/schemas";

export interface BusinessBrainService {
  query(ctx: TenantContext, query: BrainQuery): Promise<BrainResponse>;
  getSessionHistory(
    ctx: TenantContext,
    sessionId: string,
  ): Promise<{
    readonly messages: readonly {
      readonly role: string;
      readonly content: string;
      readonly timestamp: Date;
    }[];
  }>;
}

export class DefaultBusinessBrainService implements BusinessBrainService {
  private readonly sessions = new Map<string, ConversationMessage[]>();

  constructor(
    private readonly assembler: ContextAssembler,
    private readonly adapter?: AIProviderAdapter,
    private readonly clock: Clock = systemClock,
  ) {}

  async query(ctx: TenantContext, query: BrainQuery): Promise<BrainResponse> {
    const start = this.clock.now().getTime();
    const sessionKey = this.sessionKey(ctx, query.sessionId);

    // 1. Sanitize user message
    const cleanMessage = query.message.trim();

    // 2. Assemble context deterministically from read-only tools and RAG
    const assembly = await this.assembler.assemble(ctx, {
      question: cleanMessage,
    });

    // 3. Map evidence references from compiled context
    const evidenceRefs: EvidenceReference[] = [];
    for (const item of assembly.evidence.items) {
      evidenceRefs.push({
        type:
          item.type === "deterministic_metric"
            ? "calculation"
            : item.type === "retrieved_document"
              ? "rag_document"
              : "document",
        resourceId: item.source.id,
        description: item.label,
        value: item.id,
      });
    }

    // 4. Determine confidence
    let confidence: "high" | "medium" | "low" = "high";
    if (
      assembly.context.uncertainties.length > 0 ||
      (assembly.context.authoritativeFacts.length === 0 &&
        assembly.context.deterministicMetrics.length === 0)
    ) {
      confidence = "low";
    } else if (assembly.context.conflicts.length > 0) {
      confidence = "medium";
    }

    // 5. Generate or ground answer
    let answerText = "";
    let tokensUsed = 0;
    let modelUsed = "deterministic-grounding";
    let degradedReason: string | undefined;

    if (this.adapter) {
      try {
        const defaultModel: ModelConfig = {
          provider: "google",
          // Empty means "resolve from the role's configuration". A hardcoded id
          // here silently defeated AI_MODEL_REASONING for every Brain answer —
          // the env override only applies when no explicit id is requested.
          modelId: "",
          role: "reasoning",
        };
        const completion = await this.adapter.complete({
          model: defaultModel,
          systemPrompt: assembly.prompt.system,
          messages: [
            ...(query.conversationHistory ?? []).map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            // The evidence goes in the request. `assembly.prompt.user` carries
            // trusted facts, deterministic metrics, retrieved evidence,
            // uncertainties, conflicts, and the merchant's question already
            // delimiter-wrapped. Sending only the bare question (as this did
            // before) asked a financial question with no business data and let
            // the model fill the gap from imagination — the exact failure the
            // prompt's own rules exist to prevent.
            { role: "user", content: assembly.prompt.user },
          ],
          responseFormat: "json",
          schema: BusinessAnswerSchema,
        });
        answerText = parseBusinessAnswer(completion.content, assembly.prompt.citableIds);
        tokensUsed = completion.usage.promptTokens + completion.usage.completionTokens;
        // Record what the adapter actually used. When an adapter cannot report
        // a resolved id, name the provider+role we asked for rather than
        // echoing an empty string.
        modelUsed =
          completion.model ?? `${defaultModel.provider}:${defaultModel.role}`;
      } catch (error) {
        // Fall back to the grounded answer — it is real data, not filler — but
        // never swallow the failure silently. `catch {}` used to hide provider
        // outages, leaving the merchant with a mysteriously terse reply and the
        // operator with no signal.
        degradedReason =
          error instanceof Error ? error.message : "Model provider unavailable";
        answerText = this.buildDeterministicAnswer(cleanMessage, assembly);
        modelUsed = "deterministic-grounding";
      }
    } else {
      answerText = this.buildDeterministicAnswer(cleanMessage, assembly);
    }

    const duration = this.clock.now().getTime() - start;

    // Record session messages
    const history = this.sessions.get(sessionKey) ?? [];
    history.push(
      { role: "user", content: cleanMessage, timestamp: this.clock.now() },
      { role: "assistant", content: answerText, timestamp: this.clock.now() },
    );
    this.sessions.set(sessionKey, history);

    const toolsUsed: ToolCallRecord[] = assembly.context.sourceReferences.map((s) => ({
      toolName: s.origin,
      input: {},
      output: null,
      latencyMs: 10,
    }));

    return {
      message: answerText,
      toolsUsed,
      evidence: evidenceRefs,
      confidence,
      metadata: {
        totalLatencyMs: duration,
        modelUsed,
        tokensUsed,
        ragContextUsed: assembly.context.retrievedEvidence.length > 0,
        ...(degradedReason ? { degradedReason } : {}),
      },
    };
  }

  /**
   * Namespaces a conversation by tenant AND user.
   *
   * The key used to be the bare `sessionId`, so two merchants who both sent
   * "default" shared one history Map — one tenant could have seen another's
   * conversation. The caller cannot choose a key that escapes its own scope.
   */
  private sessionKey(ctx: TenantContext, sessionId: string | undefined): string {
    return `${ctx.businessId}:${ctx.userId}:${sessionId ?? ""}`;
  }

  async getSessionHistory(
    ctx: TenantContext,
    sessionId: string,
  ): Promise<{
    readonly messages: readonly {
      readonly role: string;
      readonly content: string;
      readonly timestamp: Date;
    }[];
  }> {
    return {
      messages: this.sessions.get(this.sessionKey(ctx, sessionId)) ?? [],
    };
  }

  private buildDeterministicAnswer(
    question: string,
    assembly: AssemblyResult,
  ): string {
    const facts = assembly.context.authoritativeFacts;
    const metrics = assembly.context.deterministicMetrics;

    if (facts.length === 0 && metrics.length === 0) {
      return `I do not have sufficient recorded data for your business to answer: "${question}". Please ensure invoices, expenses, or sales records have been imported.`;
    }

    const lines: string[] = [];
    lines.push("Based on your authoritative business records:");
    for (const metric of metrics) {
      lines.push(`- ${metric.metric}: ${metric.valueMinorUnits / 100} ${metric.currency}`);
    }
    for (const fact of facts.slice(0, 5)) {
      lines.push(`- ${fact.statement}`);
    }
    if (assembly.context.uncertainties.length > 0) {
      lines.push(`\nNote: ${assembly.context.uncertainties.map((u) => u.detail).join("; ")}`);
    }
    return lines.join("\n");
  }
}

function parseBusinessAnswer(content: string, citableIds: readonly string[]): string {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    // Test doubles and explicitly text-oriented adapters may still return a
    // plain answer. A response that looks like JSON but is malformed fails
    // closed; real provider adapters validate the schema before returning.
    if (/^\s*[\[{]/.test(content)) {
      throw new Error("Business Brain returned malformed structured output.");
    }
    return content;
  }

  const parsed = BusinessAnswerSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("Business Brain returned invalid structured output.");
  }

  const allowed = new Set(citableIds);
  const invalidCitation = parsed.data.evidence.find((reference) => !allowed.has(reference.sourceId));
  if (invalidCitation) {
    throw new Error(`Business Brain cited unavailable evidence: ${invalidCitation.sourceId}`);
  }

  return parsed.data.answer;
}
