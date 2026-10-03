import { describe, it, expect, vi, beforeEach } from "vitest";
import { VercelAIProviderAdapter } from "@/lib/ai/providers/vercel-ai-adapter";
import type { CompletionRequest } from "@/lib/ai/providers/types";
import * as aiModule from "ai";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

describe("VercelAIProviderAdapter structured output & responseFormat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = "test-gemini-key";
  });

  it("passes Output.json() to generateText when responseFormat is 'json'", async () => {
    const mockGenerateText = vi.mocked(aiModule.generateText);
    mockGenerateText.mockResolvedValueOnce({
      text: '{"status":"ok","extracted":true}',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      finishReason: "stop",
    } as never);

    const adapter = new VercelAIProviderAdapter("google");
    const request: CompletionRequest = {
      model: {
        provider: "google",
        modelId: "gemini-2.5-flash",
        role: "fast",
      },
      systemPrompt: "You are a JSON extractor.",
      messages: [{ role: "user", content: "Extract data" }],
      responseFormat: "json",
    };

    const response = await adapter.complete(request);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs).toHaveProperty("output");
    expect(response.content).toBe('{"status":"ok","extracted":true}');
    expect(response.finishReason).toBe("stop");
    expect(response.usage.totalTokens).toBe(15);
  });

  it("extracts output object as string if text is empty when responseFormat is json", async () => {
    const mockGenerateText = vi.mocked(aiModule.generateText);
    mockGenerateText.mockResolvedValueOnce({
      text: "",
      output: { totalMinor: 5000, currency: "INR" },
      usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      finishReason: "stop",
    } as never);

    const adapter = new VercelAIProviderAdapter("google");
    const request: CompletionRequest = {
      model: {
        provider: "google",
        modelId: "gemini-2.5-flash",
        role: "fast",
      },
      systemPrompt: "Extract amount",
      messages: [{ role: "user", content: "Total is 50 INR" }],
      responseFormat: "json",
    };

    const response = await adapter.complete(request);
    expect(response.content).toBe('{"totalMinor":5000,"currency":"INR"}');
  });

  it("does not pass output property when responseFormat is text or undefined", async () => {
    const mockGenerateText = vi.mocked(aiModule.generateText);
    mockGenerateText.mockResolvedValueOnce({
      text: "Plain text answer",
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      finishReason: "stop",
    } as never);

    const adapter = new VercelAIProviderAdapter("google");
    const request: CompletionRequest = {
      model: {
        provider: "google",
        modelId: "gemini-2.5-flash",
        role: "fast",
      },
      messages: [{ role: "user", content: "Hello" }],
    };

    const response = await adapter.complete(request);
    const callArgs = mockGenerateText.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("output");
    expect(response.content).toBe("Plain text answer");
  });
});
