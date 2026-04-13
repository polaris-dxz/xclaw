import { getDatabase, type Message } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import type { ChatMessage } from '@/store'
import { parseOpenclawEventJson } from '@/lib/chat-messages/openclaw-event-shape'

export function safeParseMetadata(raw: string | null | undefined): any | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function withPhase(
  phase: 'thinking' | 'final' | 'error',
  meta: Record<string, any> | null = null,
): Record<string, any> {
  return { ...(meta || {}), phase }
}

export type ChatSqliteDb = ReturnType<typeof getDatabase>

export function createChatReply(
  db: ChatSqliteDb,
  workspaceId: number,
  conversationId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  messageType: 'text' | 'status' | 'tool_call' = 'status',
  metadata: Record<string, any> | null = null,
  openclawEventJson: string | null = null,
): ChatMessage {
  const replyInsert = db
    .prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id, openclaw_event_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      conversationId,
      fromAgent,
      toAgent,
      content,
      messageType,
      metadata ? JSON.stringify(metadata) : null,
      workspaceId,
      openclawEventJson,
    )

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
    .get(replyInsert.lastInsertRowid, workspaceId) as Message

  const parsedMeta = safeParseMetadata(row.metadata)
  const openclaw_event = parseOpenclawEventJson(row.openclaw_event_json)
  const { openclaw_event_json: _openclawRaw, ...rowRest } = row
  const payload = {
    ...rowRest,
    metadata: parsedMeta ?? undefined,
    ...(openclaw_event ? { openclaw_event } : {}),
  } as ChatMessage

  eventBus.broadcast('chat.message', payload)
  return payload
}
