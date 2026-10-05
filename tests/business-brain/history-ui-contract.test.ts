import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchChatHistory, historyExchanges } from "@/components/ai/chat-history";
afterEach(() => vi.unstubAllGlobals());
describe("Chat refresh UI contract", () => {
  it("pairs interleaved persisted turns by id rather than adjacency", () => {
    const base = { timestamp: "2026-10-05", content: "", id: "x" };
    const exchanges = historyExchanges([
      { ...base, position: 1, turnId: "a", role: "user", content: "question a" },
      { ...base, position: 2, turnId: "b", role: "user", content: "question b" },
      { ...base, position: 3, turnId: "a", role: "assistant", response: { message: "answer a", evidence: [], toolsUsed: [], confidence: "low", metadata: { modelUsed: "recorded", tokensUsed: 0, totalLatencyMs: 0, ragContextUsed: false } } },
    ]);
    expect(exchanges[0]).toMatchObject({ id: "a", question: "question a", response: { message: "answer a" } });
    expect(exchanges[1]).toMatchObject({ id: "b", question: "question b" });
  });
  it("refreshes scoped, uncached, bounded history and parses the API response", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: { messages: [], nextCursor: 4 } })));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchChatHistory("business", "session", 10)).toEqual({ messages: [], nextCursor: 4 });
    expect(fetch).toHaveBeenCalledWith("/api/businesses/business/ai/history?sessionId=session&limit=40&before=10", { cache: "no-store", signal: undefined });
  });
  it("surfaces authorization and contract errors instead of showing false empty history", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 403 }));
    await expect(fetchChatHistory("business", "session")).rejects.toThrow("could not be loaded");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: { messages: "invalid" } })));
    await expect(fetchChatHistory("business", "session")).rejects.toThrow();
  });
});
