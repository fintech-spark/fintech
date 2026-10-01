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

export type AIContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

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
