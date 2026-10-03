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
import { wrapUntrusted } from "./untrusted";

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
    const sessionId = query.sessionId || "default";

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
    const modelUsed = "deterministic-grounding";

    if (this.adapter) {
      try {
        const defaultModel: ModelConfig = {
          provider: "google",
          modelId: "gemini-1.5-pro",
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
            {
              role: "user",
              content: wrapUntrusted(cleanMessage, {
                id: "user-query",
                sourceType: "message",
              }),
            },
          ],
        });
        answerText = completion.content;
        tokensUsed = completion.usage.promptTokens + completion.usage.completionTokens;
      } catch {
        answerText = this.buildDeterministicAnswer(cleanMessage, assembly);
      }
    } else {
      answerText = this.buildDeterministicAnswer(cleanMessage, assembly);
    }

    const duration = this.clock.now().getTime() - start;

    // Record session messages
    const history = this.sessions.get(sessionId) ?? [];
    history.push(
      { role: "user", content: cleanMessage, timestamp: this.clock.now() },
      { role: "assistant", content: answerText, timestamp: this.clock.now() },
    );
    this.sessions.set(sessionId, history);

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
      },
    };
  }

  async getSessionHistory(
    _ctx: TenantContext,
    sessionId: string,
  ): Promise<{
    readonly messages: readonly {
      readonly role: string;
      readonly content: string;
      readonly timestamp: Date;
    }[];
  }> {
    return {
      messages: this.sessions.get(sessionId) ?? [],
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
