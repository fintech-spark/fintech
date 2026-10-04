// Merchant Brain: Vercel AI SDK provider adapter
//
// `lib/ai/providers/types.ts` declared `AIProviderAdapter`, and
// `modules/extraction` takes one as a constructor dependency — but no
// implementation existed anywhere, so nothing could actually reach a model.
// This is that implementation, and it is the only file in the repository that
// imports a vendor SDK.
//
// WHY AN ADAPTER AND NOT DIRECT CALLS
// -----------------------------------
//   * `import 'server-only'`. A provider key reaching a browser bundle is a
//     credential disclosure; the build must fail rather than inline it.
//   * Vendor selection is by capability (`ModelRole`), not by string comparison
//     scattered through business modules.
//   * Every failure is normalised to a small closed set of categories so callers
//     decide what is retryable without parsing provider prose.
//   * Retries cover transient categories only, with capped backoff.
//   * Timeouts are bounded per call. No request hangs.
//
// Money is never produced here. This layer moves bytes; arithmetic belongs to
// `modules/analytics` and friends.

import 'server-only';

import {
  embed as aiEmbed,
  embedMany as aiEmbedMany,
  generateText,
  Output,
  type EmbeddingModel,
  type LanguageModel,
  type ModelMessage,
} from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

import { AIProviderError } from '@/lib/errors';
import { assertNoPublicServiceRole, requireEnv } from '@/lib/supabase/env';
import { getConfiguredModelId } from '@/lib/ai/model-config';
import type {
  AIProvider,
  AIProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelRole,
  TokenUsage,
} from '@/lib/ai/providers/types';
import { SUPPORTED_ATTACHMENT_MEDIA_TYPES } from '@/lib/ai/providers/types';

// ---------------------------------------------------------------------------
// Failure taxonomy
// ---------------------------------------------------------------------------

export type ProviderFailureCategory =
  | 'auth_failed'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_request'
  | 'model_unavailable'
  | 'provider_unavailable'
  | 'context_overflow'
  | 'unknown';

const RETRYABLE: ReadonlySet<ProviderFailureCategory> = new Set<ProviderFailureCategory>([
  'rate_limited',
  'timeout',
  'provider_unavailable',
]);

export function isRetryable(category: ProviderFailureCategory): boolean {
  return RETRYABLE.has(category);
}

/**
 * Maps a driver error onto the taxonomy.
 *
 * Prefers structured status codes, falls back to message inspection as a last
 * resort. Message matching is a fallback, not the primary path: it is the part
 * that breaks silently when a vendor rewords an error.
 */
export function categoriseFailure(error: unknown): ProviderFailureCategory {
  if (error && typeof error === 'object') {
    const candidate = error as {
      statusCode?: unknown;
      status?: unknown;
      name?: unknown;
    };
    const status =
      typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : typeof candidate.status === 'number'
          ? candidate.status
          : undefined;

    if (status === 401 || status === 403) return 'auth_failed';
    if (status === 429) return 'rate_limited';
    if (status === 404) return 'model_unavailable';
    if (status !== undefined && status >= 500) return 'provider_unavailable';
    if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') return 'timeout';
  }

  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes('context') && (message.includes('long') || message.includes('exceed'))) {
    return 'context_overflow';
  }
  if (message.includes('rate limit') || message.includes('429')) return 'rate_limited';
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) {
    return 'timeout';
  }
  if (message.includes('api key') || message.includes('unauthorized')) return 'auth_failed';
  if (message.includes('does not exist') || message.includes('not found')) {
    return 'model_unavailable';
  }
  if (
    message.includes('unavailable') ||
    message.includes('503') ||
    message.includes('econnreset') ||
    message.includes('fetch failed')
  ) {
    return 'provider_unavailable';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AdapterConfig {
  readonly timeoutMs: number;
  readonly maxAttempts: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_ADAPTER_CONFIG: AdapterConfig = {
  timeoutMs: 45_000,
  maxAttempts: 3,
};

/** Reads the vendor key for a provider from the server environment only. */
function keyFor(provider: AIProvider): string {
  switch (provider) {
    case 'google':
      return requireEnv('GEMINI_API_KEY', process.env.GEMINI_API_KEY);
    case 'anthropic':
      return requireEnv('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY);
    case 'openai':
      return requireEnv('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
  }
}

/**
 * Resolves the concrete model id for a role.
 *
 * Reads the role's configured id, falling back to the vendor default for the
 * role. A missing `AI_MODEL_*` override must not break the embedding pipeline,
 * so the fallback exists; an explicitly configured value is never overridden.
 */
function resolveModelId(provider: AIProvider, role: ModelRole, override?: string): string {
  if (override && override.trim().length > 0) return override.trim();
  const configured = getConfiguredModelId(role as never);
  if (configured) return configured;
  return DEFAULT_MODEL_IDS[provider][role];
}

const DEFAULT_MODEL_IDS: Record<AIProvider, Record<ModelRole, string>> = {
  google: {
    multimodal: 'gemini-2.5-flash',
    reasoning: 'gemini-2.5-pro',
    fast: 'gemini-2.5-flash-lite',
    reviewer: 'gemini-2.5-pro',
    embedding: 'gemini-embedding-001',
  },
  anthropic: {
    multimodal: 'claude-sonnet-4-5',
    reasoning: 'claude-opus-4-5',
    fast: 'claude-haiku-4-5',
    reviewer: 'claude-opus-4-5',
    // Anthropic does not publish an embedding model. Requesting one is a
    // configuration error, and the empty string makes that loud rather than
    // silently routing text to a chat model.
    embedding: '',
  },
  openai: {
    multimodal: 'gpt-4.1-mini',
    reasoning: 'gpt-4.1',
    fast: 'gpt-4.1-mini',
    reviewer: 'gpt-4.1',
    embedding: 'text-embedding-3-small',
  },
};

function assertEmbeddingCapable(provider: AIProvider, modelId: string): void {
  if (modelId.trim().length === 0) {
    throw new AIProviderError(
      `provider "${provider}" has no embedding model; set AI_MODEL_EMBEDDING`,
      provider,
    );
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class VercelAIProviderAdapter implements AIProviderAdapter {
  readonly provider: AIProvider;
  private readonly config: AdapterConfig;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(provider: AIProvider, config: Partial<AdapterConfig> = {}) {
    // A provider key must never be reachable from a NEXT_PUBLIC_ variable. The
    // Supabase helper already encodes that name list; reuse it rather than
    // maintaining a second one.
    assertNoPublicServiceRole();
    this.provider = provider;
    this.config = { ...DEFAULT_ADAPTER_CONFIG, ...config };
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    // Fail-closed before the first attempt and before any key is read:
    // unsupported or empty attachments never reach the vendor.
    assertSupportedAttachments(request);
    const messages = request.messages.map(toModelMessage);

    const modelId = resolveModelId(this.provider, request.model.role, request.model.modelId);
    const languageModel = this.languageModel(modelId);

    return this.withRetry('complete', async () => {
      const result = await this.withTimeout(
        generateText({
          model: languageModel,
          ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
          messages,
          maxOutputTokens: request.model.maxTokens ?? 4096,
          temperature: request.model.temperature ?? 0,
          // A schema means schema-CONSTRAINED generation, validated by the SDK
          // before we ever see the text. Without one, `Output.json()` only asks
          // for JSON syntax — a well-formed document that fails every business
          // rule still parses. Callers that need a guarantee must pass a schema.
          ...(request.schema
            ? { output: Output.object({ schema: request.schema }) }
            : request.responseFormat === 'json'
              ? { output: Output.json() }
              : {}),
        }),
      );

      const toolCalls = extractToolCalls(result) ?? [];
      const finishReason: CompletionResponse['finishReason'] =
        result.finishReason === 'tool-calls'
          ? 'tool_calls'
          : result.finishReason === 'length'
            ? 'length'
            : 'stop';

      const content =
        result.text ||
        (result.output !== undefined
          ? typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output)
          : '');

      // Fail closed. An empty completion used to return as a successful `stop`,
      // which pushed a blank string downstream to be rendered as an answer or
      // parsed as JSON. Empty is not a valid completion; it is a provider fault.
      if (content.trim().length === 0) {
        throw new AIProviderError(
          'The model returned an empty response.',
          this.provider,
        );
      }

      return {
        content,
        ...(toolCalls.length > 0 ? { toolCalls: toolCalls as NonNullable<CompletionResponse['toolCalls']> } : {}),
        usage: toTokenUsage(result.usage),
        finishReason,
        // The RESOLVED id, not the requested one: resolveModelId may have
        // overridden it from the role's configured value.
        model: modelId,
      };
    });
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const modelId = resolveModelId(this.provider, 'embedding', request.model.modelId);
    assertEmbeddingCapable(this.provider, modelId);
    const embeddingModel = this.embeddingModel(modelId);
    const inputs = Array.isArray(request.input) ? request.input : [request.input];

    return this.withRetry('embed', async () => {
      const result =
        inputs.length === 1
          ? await this.withTimeout(
              aiEmbed({ model: embeddingModel, value: inputs[0] as string }),
            )
          : await this.withTimeout(
              aiEmbedMany({ model: embeddingModel, values: inputs as string[] }),
            );

      // The single-value path returns one EmbedResult; the batch path returns
      // an EmbedManyResult. Normalising here keeps the caller free of the
      // distinction, and the `embeddings` field is the documented discriminator.
      const batched = result as { embeddings?: readonly (readonly number[])[] };
      const embeddings = Array.isArray(batched.embeddings)
        ? batched.embeddings.map((embedding) => [...embedding])
        : [[...(result as { embedding: readonly number[] }).embedding]];

      return {
        embeddings,
        usage: { promptTokens: result.usage.tokens, completionTokens: 0, totalTokens: result.usage.tokens },
      };
    });
  }

  private languageModel(modelId: string): LanguageModel {
    switch (this.provider) {
      case 'google':
        return createGoogleGenerativeAI({ apiKey: keyFor('google') })(modelId);
      case 'anthropic':
        return createAnthropic({ apiKey: keyFor('anthropic') })(modelId);
      case 'openai':
        return createOpenAI({ apiKey: keyFor('openai') })(modelId);
    }
  }

  private embeddingModel(modelId: string): EmbeddingModel {
    switch (this.provider) {
      case 'google':
        return createGoogleGenerativeAI({ apiKey: keyFor('google') }).embedding(modelId);
      case 'anthropic':
        throw new AIProviderError(
          'anthropic does not provide an embedding model',
          this.provider,
        );
      case 'openai':
        return createOpenAI({ apiKey: keyFor('openai') }).embedding(modelId);
    }
  }

  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`provider request exceeded ${this.config.timeoutMs}ms`)),
        this.config.timeoutMs,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Retries transient categories only, with capped exponential backoff. */
  private async withRetry<T>(operation: string, work: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        lastError = error;
        const category = categoriseFailure(error);

        // An auth failure or a context overflow will not fix itself, and
        // retrying either just burns budget and delays the error.
        if (!isRetryable(category) || attempt === this.config.maxAttempts) {
          throw new AIProviderError(
            `provider "${this.provider}" failed during ${operation} (${category})`,
            this.provider,
            { operation, category },
          );
        }
        await this.sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }

    throw new AIProviderError(
      `provider "${this.provider}" failed during ${operation}`,
      this.provider,
      { category: categoriseFailure(lastError) },
    );
  }
}

export function createProviderAdapter(
  provider: AIProvider,
  config?: Partial<AdapterConfig>,
): VercelAIProviderAdapter {
  return new VercelAIProviderAdapter(provider, config);
}

// ---------------------------------------------------------------------------
// Shape adaptation
// ---------------------------------------------------------------------------

export function toModelMessage(message: CompletionRequest['messages'][number]): ModelMessage {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content } as ModelMessage;
  }

  // Mapped explicitly rather than cast: a blind cast forwards our own part
  // shape to the SDK, and the SDK silently ignores a part it does not
  // recognise — which is how a scanned invoice reaches the model as text-only.
  const content = message.content.map((part) =>
    part.type === 'text'
      ? ({ type: 'text', text: part.text } as const)
      : ({ type: 'file', data: part.data, mediaType: part.mediaType } as const),
  );

  return { role: message.role, content } as ModelMessage;
}

/**
 * Rejects content the provider must not receive, before any network call.
 *
 * Thrown outside `withRetry`: an unsupported media type is permanent, and
 * retrying it would burn attempts on a request that cannot succeed.
 */
export function assertSupportedAttachments(request: CompletionRequest): void {
  for (const message of request.messages) {
    if (typeof message.content === 'string') continue;

    for (const part of message.content) {
      if (part.type !== 'file') continue;

      if (!(SUPPORTED_ATTACHMENT_MEDIA_TYPES as readonly string[]).includes(part.mediaType)) {
        throw new AIProviderError(
          `unsupported attachment media type "${part.mediaType}"`,
          request.model.provider,
          { operation: 'complete', category: 'invalid_request' },
        );
      }
      if (part.data.length === 0) {
        throw new AIProviderError(
          'attachment payload is empty',
          request.model.provider,
          { operation: 'complete', category: 'invalid_request' },
        );
      }
    }
  }
}

interface RawToolCall {
  readonly toolCallId?: string;
  readonly input?: unknown;
  readonly toolName?: string;
  readonly args?: unknown;
}

function extractToolCalls(result: {
  readonly toolCalls?: readonly RawToolCall[];
}): CompletionResponse['toolCalls'] {
  if (!result.toolCalls || result.toolCalls.length === 0) return undefined;

  return result.toolCalls.map((call, index) => ({
    id: call.toolCallId ?? `call_${index}`,
    name: call.toolName ?? 'unknown',
    arguments: normaliseArguments(call.input ?? call.args),
  }));
}

/**
 * Coerces a provider tool-call payload to `Record<string, unknown>`.
 *
 * A non-object payload becomes an empty argument set rather than being spread,
 * so a malformed provider response cannot inject a non-object where the caller
 * expects validated input.
 */
function normaliseArguments(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toTokenUsage(usage: {
  readonly inputTokens?: number | undefined;
  readonly outputTokens?: number | undefined;
  readonly totalTokens?: number | undefined;
}): TokenUsage {
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
  };
}
