import { describe, expect, it } from "vitest";
import { DefaultEvidenceService, type EvidenceSource } from "@/modules/evidence";
import { BUSINESS_A, BUSINESS_B, tenantFor } from "../helpers/fake-database";
const ctx = tenantFor(BUSINESS_A);
const source: EvidenceSource = { id: "[M-revenue]", businessId: BUSINESS_A, userId: ctx.userId, resourceId: "sales_summary:revenue:INR", kind: "deterministic_metric", origin: "tool:sales_summary@v1", content: "revenue=123400 minor units INR", observedAt: "2026-10-01T00:00:00.000Z", confidence: "high" };
const claim = { claim: source.content, claimType: "deterministic_calculation" as const, sourceIds: [source.id], promptVersion: "business-context.v2" };
const serviceFor = (sources = [source]) => new DefaultEvidenceService({ resolve: async (_ctx, ids) => sources.filter((s) => ids.includes(s.id)) }, { now: () => new Date("2026-10-05T00:00:00.000Z") });
describe("Real source evidence envelopes", () => {
  it("preserves authorized source ids, timestamps, snapshot content and derived confidence without invented impact", async () => {
    const result = await serviceFor().createEnvelope(ctx, claim);
    expect(result.status).toBe("verified");
    if (result.status !== "verified") throw new Error("expected verified");
    expect(result.envelope.sourceIds).toEqual([source.id]);
    expect(result.envelope.evidence).toContain(source.content);
    expect(result.envelope.freshness).toEqual({ sourceTimestamp: source.observedAt, lastVerified: "2026-10-05T00:00:00.000Z" });
    expect(result.envelope).not.toHaveProperty("impact");
    expect(result.envelope.confidence.label).toBe("high");
    expect((await serviceFor().verifyEnvelope(ctx, result.envelope)).status).toBe("verified");
  });
  it.each([{ sourceIds: [] }, { sourceIds: ["unknown"] }, { sourceIds: [source.id, "unknown"] }])("missing references are insufficient, never fabricated: %j", async ({ sourceIds }) => {
    const result = await serviceFor().createEnvelope(ctx, { ...claim, sourceIds });
    expect(result.status).toBe("insufficient_evidence");
    expect(result).not.toHaveProperty("envelope");
  });
  it("denies a source from another business or another user", async () => {
    await expect(serviceFor([{ ...source, businessId: BUSINESS_B }]).createEnvelope(ctx, claim)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(serviceFor([{ ...source, userId: "someone-else" }]).createEnvelope(ctx, claim)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(serviceFor().createEnvelope({ ...ctx, role: "staff" }, claim)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects undated provenance and detects altered content on re-verification", async () => {
    expect((await serviceFor([{ ...source, observedAt: "undated" }]).createEnvelope(ctx, claim)).status).toBe("insufficient_evidence");
    const result = await serviceFor().createEnvelope(ctx, claim);
    if (result.status !== "verified") throw new Error("expected verified");
    expect((await serviceFor([{ ...source, content: "changed" }]).verifyEnvelope(ctx, result.envelope)).status).toBe("insufficient_evidence");
    await expect(serviceFor().verifyEnvelope(tenantFor(BUSINESS_B), result.envelope)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
