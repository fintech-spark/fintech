// Merchant Brain: embedding provider abstraction
//
// The RAG domain depends on `EmbeddingProvider`, never on a vendor SDK. The
// concrete `ProviderEmbeddingProvider` below is the only place that knows
// `AIProviderAdapter` exists, so swapping vendors touches one file.
//
// FAILURE POLICY
// --------------
// A dropped embedding is a silent data-loss bug: the chunk stays in the
// document, the model later answers "no information found", and nothing records
// that indexing failed. So:
//
//   * failures are categorised, and only genuinely transient ones are retried
//   * a malformed provider response is a hard failure, not a retry
//   * a dimension mismatch is a hard failure, because a wrong-width vector is
//     rejected by Postgres and silently truncating it would corrupt recall
//   * `embedBatch` reports per-item failures instead of pretending it succeeded
//
// The dimension is checked against the `vector(1536)` column declared in
// migration 20261002000001. Changing embedding models requires a migration.

import { AIProviderError } from '@/lib/errors';
import type { AIProviderAdapter, EmbeddingRequest, ModelConfig } from '@/lib/ai/providers/types';

/** Must match `document_embeddings.embedding vector(1536)`. */
export const EMBEDDING_DIMENSIONS = 1536;

export type EmbeddingVector = readonly number[];

export interface EmbeddingBatchResult {
  /**
   * Index-aligned with the input: `vectors[i]` is the embedding of `texts[i]`,
   * or `undefined` when that index failed (in which case `failures` says why).
   *
   * Alignment is the contract. A compacted array makes every later index point
   * at the wrong text once a batch in the middle fails — the chunk keeps a real
   * vector, just not its own.
   */
  readonly vectors: readonly (EmbeddingVector | undefined)[];
  /** Index-aligned with the input. Never silently omitted. */
  readonly failures: readonly { readonly index: number; readonly reason: string }[];
  readonly provider: string;
  readonly model: string;
}

export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<EmbeddingVector>;
  embedBatch(texts: readonly string[]): Promise<EmbeddingBatchResult>;
}

export type EmbeddingFailureCategory =
  | 'rate_limited'
  | 'timeout'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'dimension_mismatch'
  | 'auth_failed'
  | 'unknown';

const RETRYABLE: ReadonlySet<EmbeddingFailureCategory> = new Set([
  'rate_limited',
  'timeout',
  'provider_unavailable',
]);

export function isRetryableEmbeddingFailure(category: EmbeddingFailureCategory): boolean {
  return RETRYABLE.has(category);
}

export interface ProviderEmbeddingOptions {
  readonly provider: AIProviderAdapter;
  readonly model: ModelConfig;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  /** Injected so tests need no real clock. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly expectedDimensions?: number;
}

/** Bounded batch size. One oversized request is one oversized failure. */
export const EMBEDDING_BATCH_SIZE = 32;

export class ProviderEmbeddingProvider implements EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimensions: number;

  private readonly adapter: AIProviderAdapter;
  private readonly modelConfig: ModelConfig;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly expected: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ProviderEmbeddingOptions) {
    this.adapter = options.provider;
    this.modelConfig = options.model;
    this.provider = options.provider.provider;
    this.model = options.model.modelId;
    this.expected = options.expectedDimensions ?? EMBEDDING_DIMENSIONS;
    this.dimensions = this.expected;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const result = await this.embedBatch([text]);
    const failure = result.failures[0];
    if (failure) {
      throw new AIProviderError(
        `embedding failed: ${failure.reason}`,
        this.provider,
        { reason: failure.reason },
      );
    }
    const vector = result.vectors[0];
    if (!vector) {
      throw new AIProviderError('embedding provider returned no vector', this.provider);
    }
    return vector;
  }

  async embedBatch(texts: readonly string[]): Promise<EmbeddingBatchResult> {
    if (texts.length === 0) {
      return { vectors: [], failures: [], provider: this.provider, model: this.model };
    }

    // Slots, not a push list: a failed batch must leave a hole at its own
    // indices instead of shifting every later vector down by one batch.
    const vectors: (EmbeddingVector | undefined)[] = new Array(texts.length).fill(undefined);
    const failures: { index: number; reason: string }[] = [];

    for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
      const outcome = await this.embedOneBatch(batch);
      if (outcome.ok) {
        outcome.vectors.forEach((vector, index) => {
          vectors[offset + index] = vector;
        });
      } else {
        // Attribute the failure to every item in the batch rather than
        // guessing which one the provider choked on.
        batch.forEach((_, index) => {
          failures.push({ index: offset + index, reason: outcome.reason });
        });
      }
    }

    return { vectors, failures, provider: this.provider, model: this.model };
  }

  private async embedOneBatch(
    batch: readonly string[],
  ): Promise<{ ok: true; vectors: EmbeddingVector[] } | { ok: false; reason: string }> {
    let lastReason = 'embedding provider failed';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const request: EmbeddingRequest = { model: this.modelConfig, input: [...batch] };
        const response = await withTimeout(this.timeoutMs, this.adapter.embed(request));

        if (!response || !Array.isArray(response.embeddings)) {
          return { ok: false, reason: 'embedding provider returned a malformed response' };
        }
        if (response.embeddings.length !== batch.length) {
          return {
            ok: false,
            reason: `embedding provider returned ${response.embeddings.length} vectors for ${batch.length} inputs`,
          };
        }

        const invalid = response.embeddings.findIndex(
          (vector) => !Array.isArray(vector) || vector.length !== this.expected,
        );
        if (invalid !== -1) {
          return {
            ok: false,
            reason: `embedding provider returned a vector of width ${response.embeddings[invalid]?.length ?? 0}, expected ${this.expected}`,
          };
        }

        return { ok: true, vectors: response.embeddings };
      } catch (error) {
        const category = categorise(error);
        lastReason = describe(category);
        if (!isRetryableEmbeddingFailure(category) || attempt === this.maxAttempts) {
          return { ok: false, reason: lastReason };
        }
        // Capped exponential backoff. Uncapped retry against a rate-limited
        // provider is how a retry loop becomes an outage.
        await this.sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }

    return { ok: false, reason: lastReason };
  }
}

function describe(category: EmbeddingFailureCategory): string {
  switch (category) {
    case 'rate_limited':
      return 'embedding provider rate limited the request';
    case 'timeout':
      return 'embedding provider timed out';
    case 'provider_unavailable':
      return 'embedding provider unavailable';
    case 'invalid_response':
      return 'embedding provider returned a malformed response';
    case 'dimension_mismatch':
      return 'embedding provider returned an incompatible vector width';
    case 'auth_failed':
      return 'embedding provider rejected the credentials';
    case 'unknown':
      return 'embedding provider failed';
  }
}

/**
 * Maps a provider error onto the retry taxonomy.
 *
 * Prefers a structured status when the driver exposes one, then falls back to
 * message inspection. Message matching is a last resort, not the primary path.
 */
export function categorise(error: unknown): EmbeddingFailureCategory {
  if (error && typeof error === 'object') {
    const candidate = error as { statusCode?: unknown; status?: unknown; name?: unknown };
    const status = typeof candidate.statusCode === 'number'
      ? candidate.statusCode
      : typeof candidate.status === 'number'
        ? candidate.status
        : undefined;
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403) return 'auth_failed';
    if (status !== undefined && status >= 500) return 'provider_unavailable';
    if (candidate.name === 'AbortError' || candidate.name === 'TimeoutError') return 'timeout';
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('rate limit') || message.includes('429')) return 'rate_limited';
  if (message.includes('timeout') || message.includes('timed out') || message.includes('abort')) {
    return 'timeout';
  }
  if (message.includes('dimension') || message.includes('vector width')) {
    return 'dimension_mismatch';
  }
  if (message.includes('unavailable') || message.includes('503') || message.includes('econnreset')) {
    return 'provider_unavailable';
  }
  if (message.includes('unauthorized') || message.includes('forbidden')) return 'auth_failed';
  return 'unknown';
}

async function withTimeout<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`operation exceeded ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
