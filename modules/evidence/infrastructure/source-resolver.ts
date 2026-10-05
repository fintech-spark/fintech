import type { TenantContext } from "@/lib/types";
import type { TenantDatabaseClient } from "@/lib/database";
import { AuthorizationError } from "@/lib/errors";
import { assertPermission } from "@/lib/http/auth-context";
import type { EvidenceSource } from "../domain/types";
import type { EvidenceSourceResolver } from "../application/evidence-service";

/** Sources are supplied ONLY by the server's current deterministic context assembly. */
export class PgEvidenceSourceResolver implements EvidenceSourceResolver {
  constructor(private readonly db: TenantDatabaseClient, private readonly sources: readonly EvidenceSource[]) {}

  async resolve(ctx: TenantContext, ids: readonly string[]): Promise<readonly EvidenceSource[]> {
    if (ctx.businessId !== this.db.businessId) throw new AuthorizationError();
    assertPermission(ctx, "analytics:read");
    const members = await this.db.query<{ role: string }>(`SELECT role FROM business_members
      WHERE business_id = $1 AND user_id = $2 AND status = 'active'
      AND role IN ('owner','admin','manager','accountant') LIMIT 1`, [ctx.businessId, ctx.userId]);
    if (!members.length) throw new AuthorizationError("No active analytics membership.");
    const resolved: EvidenceSource[] = [];
    for (const id of ids) {
      const source = this.sources.find((item) => item.id === id && item.businessId === ctx.businessId && item.userId === ctx.userId);
      if (!source) continue;
      if (source.kind !== "retrieved_document") { resolved.push(source); continue; }
      if (!source.chunkId || !source.documentId) continue;
      const rows = await this.db.query<{ content: string; uploaded_at: Date | string }>(`SELECT c.content, d.uploaded_at
        FROM document_embeddings c JOIN documents d ON d.id = c.document_id AND d.business_id = $1
        WHERE c.business_id = $1 AND c.id = $2 AND d.id = $3 LIMIT 1`, [ctx.businessId, source.chunkId, source.documentId]);
      const row = rows[0];
      if (!row || row.content !== source.content) continue;
      const timestamp = new Date(row.uploaded_at);
      if (!Number.isFinite(timestamp.getTime())) continue;
      resolved.push({ ...source, observedAt: timestamp.toISOString() });
    }
    return resolved;
  }
}
