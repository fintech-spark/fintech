import "server-only";

import type { BusinessId } from "@/lib/types";
import { getDatabaseClient } from "@/lib/database";
import type { TenantDatabaseClient } from "@/lib/database";
import { createToolRegistry } from "./tools/registry";
import { createBusinessReadOnlyTools } from "@/modules/business-brain/application/tools";
import { ContextAssembler } from "@/modules/business-brain/application/context-assembler";
import {
  DefaultBusinessBrainService,
  type BusinessBrainService,
} from "@/modules/business-brain/application/service";
import { VercelAIProviderAdapter } from "./providers/vercel-ai-adapter";
import { systemClock } from "@/lib/clock";
import { PgChatStore } from "@/modules/business-brain/infrastructure/chat-repository";
import { businessEmbeddingProvider } from './embedding';
import { AuthorizationError } from "@/lib/errors";
import { assertPermission } from "@/lib/http/auth-context";
import { DefaultEvidenceService, PgEvidenceSourceResolver, type EvidenceSource } from "@/modules/evidence";
import { CONTEXT_PROMPT_VERSION, type CompileOutput, type EvidenceItem } from "@/modules/business-brain";
import type { AIProviderAdapter } from "./providers/types";
import type { TenantContext } from "@/lib/types";
import {
  DefaultRAGService,
  type RagRetriever,
  PgChunkStore,
} from "@/modules/rag";

export interface ComposedBusinessBrain {
  readonly brain: BusinessBrainService;
}

export interface WireBusinessBrainOptions {
  readonly retriever?: RagRetriever;
  readonly adapter?: AIProviderAdapter;
}

/**
 * Builds the Business Brain composition root for a verified tenant.
 *
 * Scopes database queries through the TenantDatabaseClient.
 * Registers all read-only allowlisted tools and assembles the context.
 * Connects tenant-scoped RAG retrieval over document_embeddings.
 */
export function wireBusinessBrain(
  businessId: BusinessId,
  options?: WireBusinessBrainOptions,
): ComposedBusinessBrain {
  const rootDb = getDatabaseClient();
  const tenantDb = rootDb.forTenant(businessId);

  const tools = createBusinessReadOnlyTools(rootDb);
  const registry = createToolRegistry({
    tools,
    authorize: async (tenant) => {
      if (tenant.businessId !== businessId) {
         throw new AuthorizationError("Cross-tenant tool execution is blocked.");
      }
      assertPermission(tenant, "analytics:read");
    },
  });

  let adapter: AIProviderAdapter | undefined = options?.adapter;
  if (!adapter) {
    try {
      const provider = process.env.AI_PROVIDER === "anthropic"
        ? "anthropic"
        : process.env.AI_PROVIDER === "openai"
          ? "openai"
          : "google";
      adapter = new VercelAIProviderAdapter(provider);
    } catch {
      adapter = undefined;
    }
  }

  let retriever: RagRetriever | undefined = options?.retriever;
  if (!retriever && adapter) {
    try {
      const embeddingProvider = businessEmbeddingProvider(adapter);
      const store = new PgChunkStore({ database: rootDb });
      retriever = new DefaultRAGService({
        store,
        embeddings: embeddingProvider,
      });
    } catch {
      retriever = undefined;
    }
  }

  const assembler = new ContextAssembler({
    registry,
    retriever,
    now: () => systemClock.now(),
    authorizeEvidence: (ctx, compiled) => authorizeCompiledEvidence(ctx, compiled, tenantDb),
  });

  const brain = new DefaultBusinessBrainService(assembler, adapter, systemClock, new PgChatStore(tenantDb));

  return { brain };
}

async function authorizeCompiledEvidence(ctx: TenantContext, compiled: CompileOutput, db: TenantDatabaseClient): Promise<CompileOutput> {
  const sources: EvidenceSource[] = compiled.evidence.items.map((item) => ({
    id: item.id, businessId: ctx.businessId, userId: ctx.userId,
    resourceId: item.source.documentId ?? item.source.id, kind: item.type,
    origin: item.source.origin, observedAt: item.observedAt, confidence: item.confidence,
    content: item.type === "retrieved_document" ? compiled.context.retrievedEvidence.find((e) => e.id === item.id)?.content ?? ""
      : item.type === "deterministic_metric" ? JSON.stringify(compiled.context.deterministicMetrics.find((m) => m.id === item.id)) ?? ""
      : compiled.context.authoritativeFacts.find((f) => f.id === item.id)?.statement ?? "",
    ...(item.source.documentId ? { documentId: item.source.documentId, chunkId: item.source.chunkId } : {}),
  }));
  // Retrieved text is re-resolved against BOTH document and chunk tenant before
  // it enters the model prompt. Tool sources are authorized query snapshots.
  const resolved = await new PgEvidenceSourceResolver(db, sources).resolve(ctx, sources.map((s) => s.id));
  const service = new DefaultEvidenceService({ resolve: async (_ctx, ids) => resolved.filter((source) => ids.includes(source.id)) });
  const items: EvidenceItem[] = [];
  for (const item of compiled.evidence.items) {
    const source = resolved.find((s) => s.id === item.id);
    if (!source) continue;
    const result = await service.createEnvelope(ctx, { claim: item.label, claimType: item.type === "deterministic_metric" ? "deterministic_calculation" : item.type === "retrieved_document" ? "interpretation" : "fact", sourceIds: [item.id], promptVersion: CONTEXT_PROMPT_VERSION });
    if (result.status === "verified") items.push({ ...item, observedAt: source.observedAt, snapshotId: result.envelope.id, provenance: result.envelope });
  }
  const allowed = new Set(items.map((item) => item.id));
  const conflicts = compiled.context.conflicts.filter((conflict) => allowed.has(conflict.evidenceSource.id) && items.some((item) => item.source.id === conflict.structuredSource.id));
  return { evidence: { items, citableIds: [...allowed] }, context: {
    ...compiled.context,
    authoritativeFacts: compiled.context.authoritativeFacts.filter((f) => allowed.has(f.id)),
    deterministicMetrics: compiled.context.deterministicMetrics.filter((m) => allowed.has(m.id)),
    retrievedEvidence: compiled.context.retrievedEvidence.filter((e) => allowed.has(e.id)),
    conflicts,
    uncertainties: [...compiled.context.uncertainties.filter((u) => u.reason !== "conflicting_sources" || conflicts.some((c) => u.id === `U-${c.id}`)), ...(items.length < compiled.evidence.items.length ? [{ id: "U-unresolved-source", subject: "source provenance", reason: "no_evidence_retrieved" as const, detail: "Some source references could not be authorized or resolved. Their evidence is insufficient; do not rely on them." }] : [])],
  } };
}
