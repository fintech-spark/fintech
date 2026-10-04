// Merchant Brain: adapter fail-closed and telemetry contracts.
//
// These pin three properties that were previously violated:
//
//   1. An EMPTY completion is a provider fault, not a successful `stop` that
//      hands "" downstream to be rendered as an answer or parsed as JSON.
//   2. `CompletionResponse.model` reports the RESOLVED model id (after the
//      AI_MODEL_* role override), so telemetry is not wrong by construction.
//   3. A caller-supplied Zod schema routes to `Output.object({ schema })`,
//      i.e. schema-CONSTRAINED generation, rather than JSON syntax alone.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import * as aiModule from 'ai';
import { VercelAIProviderAdapter } from '@/lib/ai/providers/vercel-ai-adapter';
import type { CompletionRequest } from '@/lib/ai/providers/types';
import { AIProviderError } from '@/lib/errors';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return { ...actual, generateText: vi.fn() };
});

const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function baseRequest(overrides: Partial<CompletionRequest> = {}): CompletionRequest {
  return {
    model: { provider: 'google', modelId: 'gemini-2.5-flash', role: 'fast' },
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

describe('VercelAIProviderAdapter — fail-closed and telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    delete process.env.AI_MODEL_FAST;
  });

  it('rejects an empty completion instead of returning it as a successful stop', async () => {
    vi.mocked(aiModule.generateText).mockResolvedValueOnce({
      text: '',
      usage,
      finishReason: 'stop',
    } as never);

    const adapter = new VercelAIProviderAdapter('google');

    await expect(adapter.complete(baseRequest())).rejects.toBeInstanceOf(AIProviderError);
  });

  it('rejects a whitespace-only completion', async () => {
    vi.mocked(aiModule.generateText).mockResolvedValueOnce({
      text: '   \n  ',
      usage,
      finishReason: 'stop',
    } as never);

    const adapter = new VercelAIProviderAdapter('google');

    await expect(adapter.complete(baseRequest())).rejects.toBeInstanceOf(AIProviderError);
  });

  it('reports the resolved model id when no explicit id is requested', async () => {
    process.env.AI_MODEL_FAST = 'gemini-2.5-flash-lite-env-override';
    vi.mocked(aiModule.generateText).mockResolvedValueOnce({
      text: 'ok',
      usage,
      finishReason: 'stop',
    } as never);

    const adapter = new VercelAIProviderAdapter('google');
    // modelId: '' is the "resolve from configuration" signal — the same one the
    // Business Brain and extraction services use.
    const response = await adapter.complete(
      baseRequest({ model: { provider: 'google', modelId: '', role: 'fast' } }),
    );

    expect(response.model).toBe('gemini-2.5-flash-lite-env-override');
  });

  it('lets an explicitly requested id win over the env override', async () => {
    process.env.AI_MODEL_FAST = 'gemini-2.5-flash-lite-env-override';
    vi.mocked(aiModule.generateText).mockResolvedValueOnce({
      text: 'ok',
      usage,
      finishReason: 'stop',
    } as never);

    const adapter = new VercelAIProviderAdapter('google');
    const response = await adapter.complete(
      baseRequest({ model: { provider: 'google', modelId: 'gemini-2.5-pro', role: 'fast' } }),
    );

    expect(response.model).toBe('gemini-2.5-pro');
  });

  it('uses schema-constrained output when a schema is supplied', async () => {
    vi.mocked(aiModule.generateText).mockResolvedValueOnce({
      text: '{"totalMinor":100}',
      usage,
      finishReason: 'stop',
    } as never);

    const schema = z.object({ totalMinor: z.number() });
    const adapter = new VercelAIProviderAdapter('google');

    await adapter.complete(baseRequest({ schema, responseFormat: 'json' }));

    const callArgs = vi.mocked(aiModule.generateText).mock.calls[0][0] as { output?: unknown };
    expect(callArgs.output).toBeDefined();
    expect(callArgs.output).not.toBe(aiModule.Output.json());
  });

  it('keeps JSON syntax mode when no schema is supplied', async () => {
    vi.mocked(aiModule.generateText).mockResolvedValueOnce({
      text: '{"ok":true}',
      usage,
      finishReason: 'stop',
    } as never);

    const adapter = new VercelAIProviderAdapter('google');
    await adapter.complete(baseRequest({ responseFormat: 'json' }));

    const callArgs = vi.mocked(aiModule.generateText).mock.calls[0][0] as { output?: { name?: string } };
    expect(callArgs.output?.name).toBe('json');
  });
});
