import { describe, expect, it } from "vitest";
import { PgEvidenceSourceResolver, type EvidenceSource } from "@/modules/evidence";
import { BUSINESS_A, BUSINESS_B, tenantFor, createFakeDatabase } from "../helpers/fake-database";
const ctx = tenantFor(BUSINESS_A);
const source: EvidenceSource = { id: "[E-chunk]", resourceId: "document", businessId: BUSINESS_A, userId: ctx.userId, kind: "retrieved_document", content: "recorded text", observedAt: "undated", origin: "document:invoice", confidence: "low", chunkId: "aaaaaaaa-0000-4000-8000-000000000001", documentId: "aaaaaaaa-0000-4000-8000-000000000002" };
describe("Postgres evidence authorization", () => {
  it("rechecks active membership and resolves document+chunk under the same tenant", async () => {
    const db = createFakeDatabase([{ match: "FROM business_members", rows: [{ role: "accountant" }] }, { match: "FROM document_embeddings", rows: [{ content: source.content, uploaded_at: "2026-10-01T00:00:00.000Z" }] }]);
    const result = await new PgEvidenceSourceResolver(db.forTenant(BUSINESS_A), [source]).resolve(ctx, [source.id]);
    expect(result[0].observedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(db.onlyCallMatching("FROM business_members").params).toEqual([BUSINESS_A, ctx.userId]);
    const call = db.onlyCallMatching("FROM document_embeddings");
    expect(call.params).toEqual([BUSINESS_A, source.chunkId, source.documentId]);
    expect(call.sql).toContain("d.business_id = $1");
    expect(call.sql).toContain("c.business_id = $1");
  });
  it("denies removed membership and cross-tenant context", async () => {
    const db = createFakeDatabase([{ match: "FROM business_members", rows: [] }]);
    const resolver = new PgEvidenceSourceResolver(db.forTenant(BUSINESS_A), [source]);
    await expect(resolver.resolve(ctx, [source.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resolver.resolve(tenantFor(BUSINESS_B), [source.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([{ rows: [] }, { rows: [{ content: "tampered text", uploaded_at: "2026-10-01" }] }])("does not invent provenance for missing or changed source", async ({ rows }) => {
    const db = createFakeDatabase([{ match: "FROM business_members", rows: [{ role: "owner" }] }, { match: "FROM document_embeddings", rows }]);
    expect(await new PgEvidenceSourceResolver(db.forTenant(BUSINESS_A), [source]).resolve(ctx, [source.id, "unknown"])).toEqual([]);
  });
});
