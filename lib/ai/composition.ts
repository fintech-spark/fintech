import "server-only";

import type { BusinessId } from "@/lib/types";
import { getDatabaseClient } from "@/lib/database";
import { createToolRegistry } from "./tools/registry";
import { createBusinessReadOnlyTools } from "@/modules/business-brain/application/tools";
import { ContextAssembler } from "@/modules/business-brain/application/context-assembler";
import {
  DefaultBusinessBrainService,
  type BusinessBrainService,
} from "@/modules/business-brain/application/service";
import { VercelAIProviderAdapter } from "./providers/vercel-ai-adapter";
import { systemClock } from "@/lib/clock";
import {
  DefaultRAGService,
  type RagRetriever,
  ProviderEmbeddingProvider,
  PgChunkStore,
} from "@/modules/rag";

export interface ComposedBusinessBrain {
  readonly brain: BusinessBrainService;
}

export interface WireBusinessBrainOptions {
  readonly retriever?: RagRetriever;
  readonly adapter?: VercelAIProviderAdapter;
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

  const tools = createBusinessReadOnlyTools(tenantDb as never);
  const registry = createToolRegistry({
    tools,
    authorize: async (tenant) => {
      if (tenant.businessId !== businessId) {
        throw new Error("Cross-tenant tool execution is blocked.");
      }
    },
  });

  let adapter: VercelAIProviderAdapter | undefined = options?.adapter;
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
      const embeddingProviderName =
        adapter.provider === "anthropic"
          ? (process.env.OPENAI_API_KEY ? "openai" : "google")
          : adapter.provider;
      const embeddingAdapter =
        adapter.provider === embeddingProviderName
          ? adapter
          : new VercelAIProviderAdapter(embeddingProviderName);

      const embeddingProvider = new ProviderEmbeddingProvider({
        provider: embeddingAdapter,
        model: {
          provider: embeddingAdapter.provider,
          modelId:
            embeddingAdapter.provider === "openai"
              ? "text-embedding-3-small"
              : "gemini-embedding-001",
          role: "embedding",
        },
      });
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
  });

  const brain = new DefaultBusinessBrainService(assembler, adapter, systemClock);

  return { brain };
}
