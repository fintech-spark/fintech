import { describe, expect, it } from "vitest";
import { validateBusinessAnswer } from "@/modules/business-brain/application/service";
const evidence = { items: [{ id: "[M-revenue]", type: "deterministic_metric" as const, source: { id: "metric", kind: "analytics" as const, origin: "tool:sales_summary@v1" }, observedAt: "2026-10-01", label: "revenue", confidence: "high" as const, untrusted: false }], citableIds: ["[M-revenue]"] };
const answer = { answer: "Recorded revenue [M-revenue]", claimType: "fact", evidence: [{ sourceId: "[M-revenue]", recordId: "metric", sourceType: "unknown" }], missingInformation: [], conflicts: [], confidence: "high" };
describe("Brain structured output fail-closed", () => {
  it("accepts exact authorized citations", () => expect(validateBusinessAnswer(JSON.stringify(answer), { evidence }).answer).toBe(answer.answer));
  it.each(["plain invented answer", "{bad", JSON.stringify({ ...answer, action: "execute" }), JSON.stringify({ ...answer, evidence: [] }), JSON.stringify({ ...answer, evidence: [{ sourceId: "[M-forged]", recordId: "metric", sourceType: "unknown" }] }), JSON.stringify({ ...answer, evidence: [{ sourceId: "[M-revenue]", recordId: "other-tenant", sourceType: "unknown" }] }), JSON.stringify({ ...answer, answer: "value [E-invented]" }), JSON.stringify({ ...answer, evidence: [{ ...answer.evidence[0], observedAt: "invented" }] }), JSON.stringify({ ...answer, evidence: [{ ...answer.evidence[0], excerpt: "fabricated quote" }] }), JSON.stringify({ ...answer, answer: "I have paid the supplier." })])("rejects malformed, action-bearing, uncited or forged output", (content) => {
    expect(() => validateBusinessAnswer(content, { evidence })).toThrow(/Business Brain/);
  });
});
