import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import { DefaultBusinessBrainService, type BrainResponse, type AssemblyResult } from "@/modules/business-brain";
import type { ChatStore } from "@/modules/business-brain/application/chat-store";
import type { ContextAssembler } from "@/modules/business-brain";
import { PgChatStore } from "@/modules/business-brain/infrastructure/chat-repository";
import { createDatabaseClient } from "@/lib/database";
import { BUSINESS_A, BUSINESS_B, tenantFor } from "./helpers/fake-database";

const sessionId = "dddddddd-0000-4000-8000-000000000001";
const response: BrainResponse = { message: "Recorded answer", confidence: "low", toolsUsed: [], evidence: [], metadata: { modelUsed: "deterministic-grounding", totalLatencyMs: 0, tokensUsed: 0, ragContextUsed: false } };

describe("Production Brain service boundaries", () => {
  it("reads persisted history from the injected store in a new service instance", async () => {
    const messages = [{ id: "stored", position: 1, turnId: "turn", role: "user" as const, content: "Recorded question", timestamp: new Date() }];
    const history = vi.fn(async () => ({ messages }));
    const store: ChatStore = { history, appendTurn: vi.fn() };
    const instance = () => new DefaultBusinessBrainService({} as ContextAssembler, undefined, undefined, store);
    expect((await instance().getSessionHistory(tenantFor(BUSINESS_A), sessionId)).messages).toEqual(messages);
    expect((await instance().getSessionHistory(tenantFor(BUSINESS_A), sessionId)).messages).toEqual(messages);
    expect(history).toHaveBeenCalledTimes(2);
  });
  it("denies mismatched tenant/user and staff before assembling context", async () => {
    const assemble = vi.fn();
    const brain = new DefaultBusinessBrainService({ assemble } as unknown as ContextAssembler);
    const ctx = tenantFor(BUSINESS_A);
    await expect(brain.query(ctx, { businessId: BUSINESS_B, userId: ctx.userId, sessionId, message: "question" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(brain.query(ctx, { businessId: BUSINESS_A, userId: "other" as never, sessionId, message: "question" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(brain.query({ ...ctx, role: "staff" }, { businessId: BUSINESS_A, userId: ctx.userId, sessionId, message: "question" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(assemble).not.toHaveBeenCalled();
  });
  it("propagates persistence failure instead of returning an unrecorded success", async () => {
    const { compileContext, assembleContextPrompt } = await import("@/modules/business-brain");
    const compiled = compileContext({ question: "question", correlationId: "test", toolEnvelopes: [], retrievedChunks: [] });
    const assembly: AssemblyResult = { ...compiled, prompt: assembleContextPrompt(compiled.context, compiled.evidence), toolFailures: [] };
    const store: ChatStore = { history: async () => ({ messages: [] }), appendTurn: async () => { throw new Error("storage unavailable"); } };
    const brain = new DefaultBusinessBrainService({ assemble: async () => assembly } as unknown as ContextAssembler, undefined, undefined, store);
    const ctx = tenantFor(BUSINESS_A);
    await expect(brain.query(ctx, { businessId: BUSINESS_A, userId: ctx.userId, sessionId, message: "question" })).rejects.toThrow("storage unavailable");
  });
});

// Real SQL concurrency/isolation checks opt in against a LOCAL database only.
// Tables are isolated in a disposable schema; the production namespace is untouched.
const localUrl = process.env.LOCAL_DATABASE_URL;
const live = localUrl ? describe : describe.skip;
live("PostgreSQL durable chat integration (local opt-in)", () => {
  const schema = `brain_test_${crypto.randomUUID().replace(/-/g, "")}`;
  let pool: pg.Pool;
  let db: ReturnType<typeof createDatabaseClient>;
  let store: PgChatStore;
  const owner = tenantFor(BUSINESS_A);
  const otherUser = { ...owner, userId: "cccccccc-0000-4000-8000-000000000002" as never };
  const legacySession = "dddddddd-0000-4000-8000-000000000099";
  beforeAll(async () => {
    if (!localUrl || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(localUrl).hostname)) throw new Error("LOCAL_DATABASE_URL must point to a local test database.");
    pool = new pg.Pool({ connectionString: localUrl });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(`CREATE TABLE ${schema}.businesses (id uuid PRIMARY KEY); CREATE TABLE ${schema}.users (id uuid PRIMARY KEY); CREATE TABLE ${schema}.business_members (business_id uuid, user_id uuid, status text, role text);`);
    const core = readFileSync(new URL("../supabase/migrations/20261002000001_core_tables.sql", import.meta.url), "utf8");
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${schema}, public`);
      for (const table of ["chat_sessions", "chat_messages"]) {
        const sql = core.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
        if (!sql) throw new Error("Core chat DDL missing");
        await client.query(sql);
      }
      await client.query("INSERT INTO businesses (id) VALUES ($1), ($2)", [BUSINESS_A, BUSINESS_B]);
      await client.query("INSERT INTO users (id) VALUES ($1), ($2)", [owner.userId, otherUser.userId]);
      await client.query("INSERT INTO business_members VALUES ($1,$2,'active','owner'),($1,$3,'active','accountant'),($4,$2,'active','owner')", [BUSINESS_A, owner.userId, otherUser.userId, BUSINESS_B]);
      await client.query("INSERT INTO chat_sessions (id,business_id,user_id) VALUES ($1,$2,$3)", [legacySession, BUSINESS_A, owner.userId]);
      await client.query("INSERT INTO chat_messages (session_id,role,content,created_at) VALUES ($1,'assistant','legacy answer','2026-10-02'),($1,'user','legacy question','2026-10-01')", [legacySession]);
      const migration = readFileSync(new URL("../supabase/migrations/20261005000022_chat_evidence_production.sql", import.meta.url), "utf8").replaceAll("public.chat_messages", `${schema}.chat_messages`);
      await client.query(migration);
      await client.query(migration); // re-run must preserve existing cursor positions
    } finally { client.release(); }
    db = createDatabaseClient({ connectionString: localUrl, options: `-c search_path=${schema},public` });
    store = new PgChatStore(db.forTenant(BUSINESS_A));
  });
  it("backfills legacy messages chronologically without changing their positions on a rerun", async () => {
    const history = await store.history(owner, legacySession);
    expect(history.messages.map((m) => m.content)).toEqual(["legacy question", "legacy answer"]);
    expect(history.messages.map((m) => m.position)).toEqual([1, 2]);
  });
  afterAll(async () => {
    await db?.close();
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await pool.end(); }
  });
  it("keeps all concurrent turns paired, ordered and durable across new instances", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, index) => store.appendTurn(owner, sessionId, `question-${index}`, { ...response, message: `answer-${index}` })));
    const page = await new PgChatStore(db.forTenant(BUSINESS_A)).history(owner, sessionId);
    expect(page.messages).toHaveLength(16);
    for (let i = 0; i < 16; i += 2) {
      const [question, answer] = page.messages.slice(i, i + 2);
      expect(question.role).toBe("user");
      expect(answer.role).toBe("assistant");
      expect(question.turnId).toBe(answer.turnId);
      expect(answer.content).toBe(question.content.replace("question", "answer"));
      expect(answer.position).toBeGreaterThan(question.position);
    }
  });
  it("cannot read or append another user's session even in the same business", async () => {
    expect((await store.history(otherUser, sessionId)).messages).toEqual([]);
    await expect(store.appendTurn(otherUser, sessionId, "forged", response)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("cannot relabel a session into another business", async () => {
    const otherStore = new PgChatStore(db.forTenant(BUSINESS_B));
    expect((await otherStore.history(tenantFor(BUSINESS_B), sessionId)).messages).toEqual([]);
    await expect(otherStore.appendTurn(tenantFor(BUSINESS_B), sessionId, "forged", response)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("paginates a changing history without overlap or losing earlier messages", async () => {
    const first = await store.history(owner, sessionId, { limit: 5 });
    await store.appendTurn(owner, sessionId, "new", response);
    const second = await store.history(owner, sessionId, { limit: 100, before: first.nextCursor });
    expect(first.nextCursor).toBeDefined();
    expect(first.messages).toHaveLength(5);
    expect(second.messages).toHaveLength(11);
    expect(second.messages.every((m) => !first.messages.some((n) => n.id === m.id))).toBe(true);
  });
  it("denies a revoked member despite stale owner context", async () => {
    await pool.query(`UPDATE ${schema}.business_members SET status='removed' WHERE business_id=$1 AND user_id=$2`, [BUSINESS_A, otherUser.userId]);
    await expect(store.appendTurn(otherUser, crypto.randomUUID(), "revoked", response)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
