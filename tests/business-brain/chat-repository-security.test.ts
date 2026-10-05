import { describe, expect, it, vi } from "vitest";
import { PgChatStore } from "@/modules/business-brain/infrastructure/chat-repository";
import type { TenantDatabaseClient, DatabaseTransaction } from "@/lib/database";
import type { BrainResponse } from "@/modules/business-brain";
import { tenantFor, BUSINESS_A, BUSINESS_B } from "../helpers/fake-database";

const session = "cccccccc-0000-4000-8000-00000000000c";
const response: BrainResponse = { message: "recorded", toolsUsed: [], evidence: [], confidence: "low", metadata: { modelUsed: "deterministic", tokensUsed: 0, totalLatencyMs: 0, ragContextUsed: false } };
function database(rows: readonly unknown[] = []) {
  const query = vi.fn(async (...args: [string, (readonly unknown[])?]) => { void args; return rows; });
  const execute = vi.fn(async (...args: [string, (readonly unknown[])?]) => { void args; return 1; });
  const tx = { query, execute } as unknown as DatabaseTransaction;
  const db = { businessId: BUSINESS_A, query, execute, transaction: vi.fn(async (fn: (tx: DatabaseTransaction) => Promise<unknown>) => fn(tx)) } as unknown as TenantDatabaseClient;
  return { db, query, execute };
}

describe("Durable chat authorization and pagination", () => {
  it("denies cross-business context and staff before accessing pg", async () => {
    const { db, query } = database();
    const store = new PgChatStore(db);
    await expect(store.history(tenantFor(BUSINESS_B), session)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(store.history({ ...tenantFor(BUSINESS_A), role: "staff" }, session)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects malformed session and unbounded pagination", async () => {
    const { db, query } = database();
    const store = new PgChatStore(db);
    await expect(store.history(tenantFor(BUSINESS_A), "forged")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(store.history(tenantFor(BUSINESS_A), session, { limit: 101 })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(store.history(tenantFor(BUSINESS_A), session, { before: NaN })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(query).not.toHaveBeenCalled();
  });
  it("orders and bounds a keyset page and scopes it to business, user, session and active role", async () => {
    const rows = [3, 2, 1].map((position) => ({ position, id: `id-${position}`, role: "user", content: `text-${position}`, created_at: new Date(), metadata: {} }));
    const { db, query } = database(rows);
    const result = await new PgChatStore(db).history(tenantFor(BUSINESS_A), session, { limit: 2, before: 4 });
    expect(result.messages.map((m) => m.position)).toEqual([2, 3]);
    expect(result.nextCursor).toBe(2);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([BUSINESS_A, tenantFor(BUSINESS_A).userId, session, 4, 3]);
    for (const predicate of ["s.business_id = $1", "s.user_id = $2", "s.id = $3", "b.status = 'active'", "ORDER BY m.position DESC", "m.position < $4"]) expect(sql).toContain(predicate);
  });
  it("does not write messages to an existing session owned by another identity", async () => {
    const { db, execute } = database();
    await expect(new PgChatStore(db).appendTurn(tenantFor(BUSINESS_A), session, "question", response)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toContain("ON CONFLICT (id) DO NOTHING");
  });
  it("locks the scoped parent and saves both messages atomically with response provenance", async () => {
    const { db, query, execute } = database([{ id: session }]);
    await new PgChatStore(db).appendTurn(tenantFor(BUSINESS_A), session, "question", response);
    expect(query.mock.calls[0][0]).toContain("FOR UPDATE OF s");
    expect(execute).toHaveBeenCalledTimes(3);
    const [sql, params] = execute.mock.calls[1];
    expect(sql).toContain("ORDER BY v.n");
    expect(sql).toContain("s.user_id = $2");
    expect(JSON.parse(String(params?.[8])).response).toEqual(response);
    expect(JSON.parse(String(params?.[5])).turnId).toBe(JSON.parse(String(params?.[8])).turnId);
  });
});
