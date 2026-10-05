import type { TenantContext } from "@/lib/types";
import type { TenantDatabaseClient } from "@/lib/database";
import { assertPermission } from "@/lib/http/auth-context";
import { AuthorizationError, NotFoundError, ValidationError } from "@/lib/errors";
import { z } from "zod";
import type { BrainResponse } from "../domain/types";
import type { ChatStore, ChatHistoryPage, HistoryOptions, StoredChatMessage } from "../application/chat-store";

const uuid = z.string().uuid();
const optionsSchema = z.object({ limit: z.number().int().min(1).max(100).default(40), before: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }).strict();
interface MessageRow {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly position: number;
  readonly created_at: Date;
  readonly metadata: { readonly turnId?: string; readonly response?: BrainResponse };
}

/** Raw pg bypasses RLS: every read/write explicitly checks business AND owner. */
export class PgChatStore implements ChatStore {
  constructor(private readonly db: TenantDatabaseClient) {}

  private authorize(ctx: TenantContext, sessionId: string): void {
    if (ctx.businessId !== this.db.businessId) throw new AuthorizationError();
    assertPermission(ctx, "analytics:read");
    if (!uuid.safeParse(sessionId).success) throw new ValidationError("Invalid chat session id.");
  }

  async appendTurn(ctx: TenantContext, sessionId: string, question: string, response: BrainResponse): Promise<void> {
    this.authorize(ctx, sessionId);
    await this.db.transaction(async (tx) => {
      // PK arbitrates simultaneous first turns. A conflict never transfers ownership.
      await tx.execute(`INSERT INTO chat_sessions (id, business_id, user_id)
        SELECT $3, $1, $2 WHERE EXISTS (SELECT 1 FROM business_members
          WHERE business_id = $1 AND user_id = $2 AND status = 'active'
          AND role IN ('owner','admin','manager','accountant'))
        ON CONFLICT (id) DO NOTHING`, [ctx.businessId, ctx.userId, sessionId]);
      const sessions = await tx.query<{ id: string }>(`SELECT s.id FROM chat_sessions s
        JOIN business_members b ON b.business_id = s.business_id AND b.user_id = s.user_id
        WHERE s.business_id = $1 AND s.user_id = $2 AND s.id = $3
          AND b.status = 'active' AND b.role IN ('owner','admin','manager','accountant')
        FOR UPDATE OF s`, [ctx.businessId, ctx.userId, sessionId]);
      if (sessions.length !== 1) throw new NotFoundError("Chat session");
      const turnId = crypto.randomUUID();
      // One transaction and a session row lock keep concurrent pairs together.
      await tx.execute(`INSERT INTO chat_messages (session_id, role, content, tools_used, evidence, metadata)
        SELECT s.id, v.role, v.content, v.tools, v.evidence, v.metadata
        FROM chat_sessions s CROSS JOIN (VALUES
          (0, 'user', $4::text, '[]'::jsonb, '[]'::jsonb, $6::jsonb),
          (1, 'assistant', $5::text, $7::jsonb, $8::jsonb, $9::jsonb)
        ) AS v(n, role, content, tools, evidence, metadata)
        WHERE s.business_id = $1 AND s.user_id = $2 AND s.id = $3 ORDER BY v.n`,
      [ctx.businessId, ctx.userId, sessionId, question, response.message,
        JSON.stringify({ turnId }), JSON.stringify(response.toolsUsed), JSON.stringify(response.evidence), JSON.stringify({ turnId, response })]);
      await tx.execute(`UPDATE chat_sessions SET last_activity_at = clock_timestamp()
        WHERE business_id = $1 AND user_id = $2 AND id = $3`, [ctx.businessId, ctx.userId, sessionId]);
    });
  }

  async history(ctx: TenantContext, sessionId: string, options: HistoryOptions = {}): Promise<ChatHistoryPage> {
    this.authorize(ctx, sessionId);
    const parsed = optionsSchema.safeParse(options);
    if (!parsed.success) throw new ValidationError("Invalid history pagination.");
    const { limit, before } = parsed.data;
    const rows = await this.db.query<MessageRow>(`SELECT m.id, m.role, m.content, m.position, m.created_at, m.metadata
      FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id AND s.business_id = $1
      JOIN business_members b ON b.business_id = s.business_id AND b.user_id = s.user_id
      WHERE s.business_id = $1 AND s.user_id = $2 AND s.id = $3
        AND b.status = 'active' AND b.role IN ('owner','admin','manager','accountant')
        AND m.role IN ('user','assistant') AND ($4::bigint IS NULL OR m.position < $4)
      ORDER BY m.position DESC LIMIT $5`, [ctx.businessId, ctx.userId, sessionId, before ?? null, limit + 1]);
    const page = rows.slice(0, limit).reverse();
    const messages: StoredChatMessage[] = page.map((row) => ({
      id: row.id, position: row.position, role: row.role, content: row.content,
      timestamp: row.created_at, turnId: row.metadata.turnId ?? row.id,
      ...(row.role === "assistant" && row.metadata.response ? { response: row.metadata.response } : {}),
    }));
    return { messages, ...(rows.length > limit ? { nextCursor: page[0].position } : {}) };
  }
}
