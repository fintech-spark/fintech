import type { TenantContext } from "@/lib/types";
import type {
  BrainQuery,
  BrainResponse,
  EvidenceReference,
} from "../domain/types";
import type { ContextAssembler, AssemblyResult } from "./context-assembler";
import type { AIProviderAdapter, ModelConfig } from "@/lib/ai/providers/types";
import type { Clock } from "@/lib/clock";
import { systemClock } from "@/lib/clock";
import { BusinessAnswerSchema } from "@/lib/ai/schemas";
import type { ChatStore, ChatHistoryPage, HistoryOptions } from "./chat-store";
import { assertPermission } from "@/lib/http/auth-context";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { neutraliseDelimiters } from "./untrusted";
import { citationContent } from "./prompt-builder";

export interface BusinessBrainService {
  query(ctx: TenantContext, query: BrainQuery): Promise<BrainResponse>;
  getSessionHistory(
    ctx: TenantContext,
    sessionId: string,
    options?: HistoryOptions,
  ): Promise<ChatHistoryPage>;
}

export class DefaultBusinessBrainService implements BusinessBrainService {
  constructor(
    private readonly assembler: ContextAssembler,
    private readonly adapter?: AIProviderAdapter,
    private readonly clock: Clock = systemClock,
    private readonly chatStore?: ChatStore,
  ) {}

  async query(ctx: TenantContext, query: BrainQuery): Promise<BrainResponse> {
    const start = this.clock.now().getTime();
    assertPermission(ctx, "analytics:read");
    if (ctx.businessId !== query.businessId || ctx.userId !== query.userId) throw new AuthorizationError();
    if (!query.message.trim() || query.message.length > 4000) throw new ValidationError("Invalid question length.");

    // 1. Sanitize user message
    const cleanMessage = query.message.trim();
    const history = this.chatStore ? await this.chatStore.history(ctx, query.sessionId, { limit: 12 }) : { messages: [] };

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
              : "calculation",
        resourceId: item.source.documentId ?? item.snapshotId ?? item.source.id,
        description: item.label,
        value: item.id,
        observedAt: item.observedAt,
        ...(item.source.documentId ? { documentId: item.source.documentId, chunkId: item.source.chunkId } : {}),
        ...(item.provenance ? { provenance: item.provenance } : {}),
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
          provider: this.adapter.provider,
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
            // The evidence goes in the request. `assembly.prompt.user` carries
            // trusted facts, deterministic metrics, retrieved evidence,
            // uncertainties, conflicts, and the merchant's question already
            // delimiter-wrapped. Sending only the bare question (as this did
            // before) asked a financial question with no business data and let
            // the model fill the gap from imagination — the exact failure the
            // prompt's own rules exist to prevent.
            { role: "user", content: `${history.messages.length ? `<conversation_history trust="untrusted" authority="none">${neutraliseDelimiters(JSON.stringify(history.messages.map((m) => ({ role: m.role, content: m.content }))).slice(0, 8000))}</conversation_history>\n` : ""}${assembly.prompt.user}` },
          ],
          responseFormat: "json",
          schema: BusinessAnswerSchema,
        });
        const answer = validateBusinessAnswer(completion.content, assembly);
        answerText = answer.answer;
        const cited = new Set(answer.evidence.map((reference) => reference.sourceId));
        evidenceRefs.splice(0, evidenceRefs.length, ...evidenceRefs.filter((reference) => cited.has(reference.value ?? "")));
        if (answer.confidence === "insufficient_evidence" || answer.confidence === "low") confidence = "low";
        else if (answer.confidence === "medium" && confidence === "high") confidence = "medium";
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
        degradedReason = error instanceof Error && error.message.startsWith("Business Brain") ? error.message : "Model provider unavailable";
        confidence = "low";
        answerText = this.buildDeterministicAnswer(cleanMessage, assembly);
        modelUsed = "deterministic-grounding";
      }
    } else {
      answerText = this.buildDeterministicAnswer(cleanMessage, assembly);
    }

    const duration = this.clock.now().getTime() - start;

    const toolsUsed = assembly.toolRecords ?? [];

    const response: BrainResponse = {
      message: answerText,
      toolsUsed,
      evidence: evidenceRefs,
      confidence,
      metadata: {
        sessionId: query.sessionId,
        totalLatencyMs: duration,
        modelUsed,
        tokensUsed,
        ragContextUsed: assembly.context.retrievedEvidence.length > 0,
        ...(degradedReason ? { degradedReason } : {}),
      },
    };
    await this.chatStore?.appendTurn(ctx, query.sessionId, cleanMessage, response);
    return response;
  }

  async getSessionHistory(
    ctx: TenantContext,
    sessionId: string,
    options?: HistoryOptions,
  ): Promise<ChatHistoryPage> {
    assertPermission(ctx, "analytics:read");
    return this.chatStore ? this.chatStore.history(ctx, sessionId, options) : { messages: [] };
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

export function validateBusinessAnswer(content: string, assembly: Pick<AssemblyResult, "evidence"> & Partial<Pick<AssemblyResult, "context">>) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new Error("Business Brain returned malformed structured output.");
  }

  const parsed = BusinessAnswerSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("Business Brain returned invalid structured output.");
  }

  const invalidCitation = parsed.data.evidence.find((reference) => {
    const source = assembly.evidence.items.find((item) => item.id === reference.sourceId);
    const sourceContent = assembly.context ? citationContent(assembly.context, reference.sourceId) : undefined;
    return !source || reference.recordId !== (source.source.documentId ?? source.snapshotId ?? source.source.id)
      || (reference.observedAt !== undefined && reference.observedAt !== source.observedAt)
      || (reference.excerpt !== undefined && (!sourceContent || !sourceContent.includes(reference.excerpt)));
  });
  if (invalidCitation) {
    throw new Error("Business Brain cited unavailable evidence; evidence is insufficient.");
  }

  if (parsed.data.confidence !== "insufficient_evidence" && parsed.data.evidence.length === 0) throw new Error("Business Brain omitted claim evidence; evidence is insufficient.");
  const inlineIds = parsed.data.answer.match(/\[(?:F|M|E)-[^\]]+\]/g) ?? [];
  if (inlineIds.some((id) => !assembly.evidence.citableIds.includes(id))) throw new Error("Business Brain cited unavailable evidence; evidence is insufficient.");
  const citedContent = parsed.data.evidence.map((reference) => {
    const source = assembly.evidence.items.find((item) => item.id === reference.sourceId)!;
    return `${assembly.context ? citationContent(assembly.context, reference.sourceId) ?? "" : ""} ${source.observedAt ?? ""}`;
  }).join(" ");
  const supported = new Set(numericClaims(citedContent));
  const prose = [parsed.data.answer, ...parsed.data.conflicts, ...parsed.data.missingInformation].join(" ")
    .replace(/\[(?:F|M|E)-[^\]]+\]/g, "")
    .replace(/\bC-\d+-\d+\b/g, (id) => assembly.context?.conflicts.some((conflict) => conflict.id === id) ? "" : id);
  if (numericClaims(prose).some((value) => !supported.has(value))) throw new Error("Business Brain returned an unsupported numeric claim; evidence is insufficient.");
  // The prompt requires minor units: matching digits cannot authorize a 100x
  // unit conversion or a different currency. Formatting remains deterministic.
  if (/[₹$€£]\s*[+\-−]?\.?\d|\b(?:INR|USD|EUR|GBP)\s*[+\-−]?\.?\d|\d\s*(?:rupees?|dollars?|euros?|pounds?|INR|USD|EUR|GBP)\b/i.test(prose)) {
    throw new Error("Business Brain returned an unsupported financial unit; evidence is insufficient.");
  }
  const supportedQuantities = new Set(financialQuantities(citedContent));
  if (financialQuantities(prose).some((quantity) => !supportedQuantities.has(quantity))) throw new Error("Business Brain returned an unsupported financial quantity; evidence is insufficient.");
  if (/\b(?:I|we) (?:have )?(?:sent|paid|ordered|deleted|executed|transferred|updated)\b/i.test(parsed.data.answer)) throw new Error("Business Brain claimed an unsupported action.");
  return parsed.data;
}

/** Exact numeric copying only; dates are checked as dates, not reusable digits. */
function numericClaims(text: string): string[] {
  return (text.replace(/−/g, "-").match(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?\b|(?<!\w)[+-]?(?:\d+(?:[,.]\d+)*|\.\d+)(?:e[+-]?\d+)?(?!\w)/gi) ?? [])
    .map((value) => /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value.replace(/,/g, ""));
}

function financialQuantities(text: string): string[] {
  return Array.from(text.replace(/−/g, "-").matchAll(/(?<!\w)([+-]?\d+(?:[,.]\d+)*(?:e[+-]?\d+)?)\s*minor units\s*([a-z]{3})\b/gi),
    ([, amount, currency]) => `${amount.replace(/,/g, "")} minor units ${currency.toUpperCase()}`);
}
