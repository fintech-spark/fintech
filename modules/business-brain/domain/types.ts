import type { BusinessId, UserId } from '@/lib/types';
export interface BrainQuery { readonly businessId: BusinessId; readonly userId: UserId; readonly sessionId: string; readonly message: string; readonly conversationHistory?: readonly ConversationMessage[]; }
export interface BrainResponse { readonly message: string; readonly toolsUsed: readonly ToolCallRecord[]; readonly evidence: readonly EvidenceReference[]; readonly confidence: 'high' | 'medium' | 'low'; readonly metadata: ResponseMetadata; }
export interface ToolCallRecord { readonly toolName: string; readonly input: Record<string, unknown>; readonly output: unknown; readonly latencyMs: number; }
export interface EvidenceReference { readonly type: EvidenceSourceType; readonly resourceId: string; readonly description: string; readonly value?: string; }
export type EvidenceSourceType = 'transaction' | 'invoice' | 'expense' | 'product' | 'customer' | 'supplier' | 'document' | 'calculation' | 'rag_document';
export interface ConversationMessage { readonly role: 'user' | 'assistant'; readonly content: string; readonly timestamp: Date; }
export interface ResponseMetadata { readonly totalLatencyMs: number; readonly modelUsed: string; readonly tokensUsed: number; readonly ragContextUsed: boolean; /**
   * Set when the answer fell back to the deterministic grounded path because the
   * model provider failed. The answer is still real data, but the merchant and
   * the operator must both be able to see that the model did not produce it.
   */
  readonly degradedReason?: string; }
