import { z } from "zod";
import { aiChatResponseSchema } from "@/lib/api/contracts";
const recordedResponseSchema = aiChatResponseSchema.extend({ metadata: aiChatResponseSchema.shape.metadata.extend({ sessionId: z.string().uuid().optional(), degradedReason: z.string().optional() }) });

export const chatHistorySchema = z.object({
  messages: z.array(z.object({
    id: z.string(), position: z.number().int().positive(), turnId: z.string(),
    role: z.enum(["user", "assistant"]), content: z.string(), timestamp: z.string(),
    response: recordedResponseSchema.optional(),
  })),
  nextCursor: z.number().int().positive().optional(),
});
export type HistoryMessage = z.infer<typeof chatHistorySchema>["messages"][number];
export type ChatHistory = z.infer<typeof chatHistorySchema>;

export async function fetchChatHistory(businessId: string, sessionId: string, before?: number, signal?: AbortSignal): Promise<ChatHistory> {
  const query = new URLSearchParams({ sessionId, limit: "40", ...(before ? { before: String(before) } : {}) });
  const response = await fetch(`/api/businesses/${encodeURIComponent(businessId)}/ai/history?${query}`, { cache: "no-store", signal });
  if (!response.ok) throw new Error("Chat history could not be loaded. Please retry.");
  return chatHistorySchema.parse((await response.json()).data);
}

export function historyExchanges(messages: readonly HistoryMessage[]) {
  const turns = new Map<string, { id: string; question: string; recordedAnswer?: string; response?: z.infer<typeof recordedResponseSchema> }>();
  for (const message of messages) {
    const turn = turns.get(message.turnId) ?? { id: message.turnId, question: "Earlier question" };
    if (message.role === "user") turn.question = message.content;
    if (message.role === "assistant") {
      turn.recordedAnswer = message.content;
      if (message.response) turn.response = message.response;
    }
    turns.set(message.turnId, turn);
  }
  return [...turns.values()];
}

export function evidenceLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "description" in value && typeof value.description === "string") return value.description;
  if (value && typeof value === "object" && "toolName" in value && typeof value.toolName === "string") return value.toolName;
  return "Recorded source";
}

export function sourceCitation(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const fields = ["value", "resourceId", "observedAt"] as const;
  return fields.flatMap((key) => key in value && typeof (value as Record<string, unknown>)[key] === "string" ? [String((value as Record<string, unknown>)[key])] : []).join(" · ");
}
