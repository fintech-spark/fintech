import type { TenantContext } from "@/lib/types";
import type { BrainResponse, ConversationMessage } from "../domain/types";

export interface HistoryOptions {
  readonly limit?: number;
  readonly before?: number;
}
export interface StoredChatMessage extends ConversationMessage {
  readonly id: string;
  readonly position: number;
  readonly turnId: string;
  readonly response?: BrainResponse;
}
export interface ChatHistoryPage {
  readonly messages: readonly StoredChatMessage[];
  readonly nextCursor?: number;
}
export interface ChatStore {
  appendTurn(ctx: TenantContext, sessionId: string, question: string, response: BrainResponse): Promise<void>;
  history(ctx: TenantContext, sessionId: string, options?: HistoryOptions): Promise<ChatHistoryPage>;
}
