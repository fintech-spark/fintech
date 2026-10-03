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

export interface ComposedBusinessBrain {
  readonly brain: BusinessBrainService;
}

/**
 * Builds the Business Brain composition root for a verified tenant.
 *
 * Scopes database queries through the TenantDatabaseClient.
 * Registers all read-only allowlisted tools and assembles the context.
 */
export function wireBusinessBrain(businessId: BusinessId): ComposedBusinessBrain {
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

  const assembler = new ContextAssembler({
    registry,
    now: () => systemClock.now(),
  });

  let adapter: VercelAIProviderAdapter | undefined;
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

  const brain = new DefaultBusinessBrainService(assembler, adapter, systemClock);

  return { brain };
}
