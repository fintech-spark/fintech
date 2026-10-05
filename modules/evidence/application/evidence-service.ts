import { createHash } from "node:crypto";
import type { TenantContext } from "@/lib/types";
import type { Clock } from "@/lib/clock";
import { systemClock } from "@/lib/clock";
import { AuthorizationError, ValidationError } from "@/lib/errors";
import { assertPermission } from "@/lib/http/auth-context";
import { z } from "zod";
import type { ClaimType, EvidenceSource, EvidenceResult, EvidenceEnvelope } from "../domain/types";

export interface EvidenceSourceResolver {
  resolve(ctx: TenantContext, ids: readonly string[]): Promise<readonly EvidenceSource[]>;
}
export interface ClaimRequest {
  readonly claim: string;
  readonly claimType: ClaimType;
  readonly sourceIds: readonly string[];
  readonly promptVersion: string;
}
export interface EvidenceService {
  createEnvelope(ctx: TenantContext, claim: ClaimRequest): Promise<EvidenceResult>;
  verifyEnvelope(ctx: TenantContext, envelope: EvidenceEnvelope): Promise<EvidenceResult>;
}
const claimSchema = z.object({ claim: z.string().trim().min(1).max(24000), claimType: z.enum(["fact", "deterministic_calculation", "interpretation", "recommendation", "draft"]), sourceIds: z.array(z.string().min(1)).max(100), promptVersion: z.string().min(1) }).strict();

/** The resolver owns authorization. Missing provenance never receives defaults. */
export class DefaultEvidenceService implements EvidenceService {
  constructor(private readonly resolver: EvidenceSourceResolver, private readonly clock: Clock = systemClock) {}

  async createEnvelope(ctx: TenantContext, claim: ClaimRequest): Promise<EvidenceResult> {
    assertPermission(ctx, "analytics:read");
    if (!claimSchema.safeParse(claim).success) throw new ValidationError("Invalid evidence claim.");
    const ids = [...new Set(claim.sourceIds)];
    const sources = await this.resolver.resolve(ctx, ids);
    if (sources.some((source) => source.businessId !== ctx.businessId || source.userId !== ctx.userId)) throw new AuthorizationError();
    const valid = sources.filter((source) => ids.includes(source.id) && source.resourceId && source.origin && source.content && Number.isFinite(Date.parse(source.observedAt)));
    const missing = ids.filter((id) => !valid.some((source) => source.id === id));
    if (!ids.length || missing.length) return { status: "insufficient_evidence", missingSourceIds: missing };
    const content = valid.map((source) => ({ id: source.id, resourceId: source.resourceId, kind: source.kind, origin: source.origin, observedAt: source.observedAt, content: source.content }));
    const evidence = JSON.stringify(content);
    const id = `evidence:${createHash("sha256").update(JSON.stringify([ctx.businessId, ctx.userId, claim.claim, content])).digest("hex")}`;
    const confidence = valid.some((s) => s.confidence === "low") ? "low" : valid.some((s) => s.confidence === "medium") ? "medium" : "high";
    return { status: "verified", envelope: {
      id, businessId: ctx.businessId, userId: ctx.userId, claim: claim.claim, claimType: claim.claimType,
      evidence, sourceIds: ids, affectedRecords: valid.map((source) => ({ recordId: source.documentId ?? source.resourceId, tenantScope: ctx.businessId })),
      explanation: claim.claim, confidence: { label: confidence },
      freshness: { sourceTimestamp: valid.map((s) => s.observedAt).sort()[0], lastVerified: this.clock.now().toISOString() },
      policyMetadata: { promptVersion: claim.promptVersion, modelRole: "reasoning", schemaVersion: "evidence.v1", reviewStatus: "verified" },
    } };
  }

  async verifyEnvelope(ctx: TenantContext, envelope: EvidenceEnvelope): Promise<EvidenceResult> {
    if (ctx.businessId !== envelope.businessId || ctx.userId !== envelope.userId) throw new AuthorizationError();
    const result = await this.createEnvelope(ctx, { claim: envelope.claim, claimType: envelope.claimType, sourceIds: envelope.sourceIds, promptVersion: envelope.policyMetadata.promptVersion });
    if (result.status === "verified" && (result.envelope.id !== envelope.id || result.envelope.evidence !== envelope.evidence || JSON.stringify(result.envelope.affectedRecords) !== JSON.stringify(envelope.affectedRecords) || result.envelope.confidence.label !== envelope.confidence.label || result.envelope.freshness.sourceTimestamp !== envelope.freshness.sourceTimestamp || (envelope.conflicts ?? []).some((c) => c.resolutionStatus === "unresolved"))) {
      return { status: "insufficient_evidence", missingSourceIds: envelope.sourceIds };
    }
    return result;
  }
}
