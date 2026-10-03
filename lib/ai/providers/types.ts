/**
 * AI Provider Adapter Interfaces
 *
 * All provider-specific code lives behind these interfaces.
 * Business modules never import Gemini / OpenAI / Anthropic SDKs directly.
 */

// ---------------------------------------------------------------------------
// Model Configuration
// ---------------------------------------------------------------------------

/** Model role determines which model configuration to use */
export type ModelRole =
  | 'multimodal'
  | 'reasoning'
  | 'fast'
  | 'reviewer'
  | 'embedding';

/** Supported AI providers */
export type AIProvider = 'google' | 'openai' | 'anthropic';

/** Provider-agnostic model configuration */
export interface ModelConfig {
  readonly provider: AIProvider;
  readonly modelId: string;
  readonly role: ModelRole;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export interface CompletionRequest {
  readonly model: ModelConfig;
  readonly systemPrompt?: string;
  readonly messages: AIMessage[];
  readonly tools?: AIToolDefinition[];
  readonly responseFormat?: 'text' | 'json';
}

export interface AIMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string | AIContentPart[];
}

/**
 * Provider-agnostic content parts.
 *
 * The binary variant is `file`, not `image`: extraction sends PDFs through the
 * same multimodal path as images, and an `image` part that carries
 * `application/pdf` is a lie the adapter would have to paper over. The shape
 * (`data` + `mediaType`) matches the AI SDK's `FilePart`, so the adapter only
 * has to validate — it never guesses field names.
 */
export type AIContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'file'; readonly data: string; readonly mediaType: string };

/**
 * Media types the AI layer will transmit to a provider.
 *
 * Fail-closed and deliberately separate from the upload allowlist in
 * `modules/extraction/infrastructure/file-validation.ts`: that list decides
 * what a merchant may upload, this one decides what may leave the process. An
 * unlisted type is rejected before any network call.
 */
export const SUPPORTED_ATTACHMENT_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export interface AIToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>; // JSON Schema
}

export interface CompletionResponse {
  readonly content: string;
  readonly toolCalls?: AIToolCall[];
  readonly usage: TokenUsage;
  readonly finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface AIToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export interface EmbeddingRequest {
  readonly model: ModelConfig;
  readonly input: string | string[];
}

export interface EmbeddingResponse {
  readonly embeddings: number[][];
  readonly usage: TokenUsage;
}

// ---------------------------------------------------------------------------
// Provider Adapter
// ---------------------------------------------------------------------------

export interface AIProviderAdapter {
  readonly provider: AIProvider;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}
