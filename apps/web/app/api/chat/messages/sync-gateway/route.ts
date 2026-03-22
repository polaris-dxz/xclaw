import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, type Message } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { eventBus } from '@/lib/event-bus'
import { getAllGatewaySessions } from '@/lib/sessions'
import { readLatestAssistantReplyFromHistory } from '@/lib/openclaw-chat-history'
import { logger } from '@/lib/logger'

function safeParseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function resolveSessionKeyForConversation(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  conversation_id: string
): string | null {
  const rows = db
    .prepare(
      `SELECT metadata FROM messages WHERE conversation_id = ? AND workspace_id = ? ORDER BY created_at DESC LIMIT 80`
    )
    .all(conversation_id, workspaceId) as Array<{ metadata: string | null }>
  for (const row of rows) {
    const meta = safeParseMetadata(row.metadata)
    if (!meta) continue
    const sk = meta.sessionKey
    if (typeof sk === 'string' && sk.trim()) return sk.trim()
    const sess = meta.session
    if (typeof sess === 'string' && sess.trim()) return sess.trim()
  }
  const sessions = getAllGatewaySessions()
  const match =
    sessions.find((s) => String(s.agent || '').toLowerCase() === 'main') ||
    (sessions.length > 0 ? sessions[0] : null)
  return match?.key || match?.sessionId || null
}

function hasAssistantWithSameContent(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  conversation_id: string,
  text: string
): boolean {
  const t = text.trim()
  if (!t) return true
  const rows = db
    .prepare(
      `SELECT content, message_type, metadata, from_agent FROM messages WHERE conversation_id = ? AND workspace_id = ? ORDER BY id DESC LIMIT 80`
    )
    .all(conversation_id, workspaceId) as Array<{
    content: string
    message_type: string
    metadata: string | null
    from_agent: string
  }>
  for (const row of rows) {
    if (row.message_type !== 'text') continue
    const meta = safeParseMetadata(row.metadata)
    const role = meta ? String(meta.role || '').toLowerCase() : ''
    const from = String(row.from_agent || '').toLowerCase()
    const isAssistant = role === 'assistant' || from === 'main'
    if (isAssistant && String(row.content || '').trim() === t) return true
  }
  return false
}

/**
 * POST：agent.wait 超时后本地只有「还在处理中」时，从 Gateway chat.history 拉最近一条 assistant 文本并落库。
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  try {
    const body = await request.json().catch(() => ({}))
    const conversation_id = String(body?.conversation_id || '').trim()
    if (!conversation_id) {
      return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })
    }
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1

    const sessionKey = resolveSessionKeyForConversation(db, workspaceId, conversation_id)
    if (!sessionKey) {
      return NextResponse.json({ ok: false, reason: 'no_session' }, { status: 200 })
    }

    const text = await readLatestAssistantReplyFromHistory(sessionKey)
    if (!text || !text.trim()) {
      return NextResponse.json({ ok: false, reason: 'no_assistant_in_history' }, { status: 200 })
    }

    if (hasAssistantWithSameContent(db, workspaceId, conversation_id, text)) {
      return NextResponse.json({ ok: true, reason: 'already_have', inserted: false }, { status: 200 })
    }

    const lastFromMain = db
      .prepare(
        `SELECT to_agent FROM messages WHERE conversation_id = ? AND workspace_id = ? AND lower(from_agent) = 'main' ORDER BY created_at DESC LIMIT 1`
      )
      .get(conversation_id, workspaceId) as { to_agent: string | null } | undefined
    const toAgent = lastFromMain?.to_agent || 'you'

    const replyInsert = db
      .prepare(
        `INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        conversation_id,
        'main',
        toAgent,
        text,
        'text',
        JSON.stringify({
          phase: 'final',
          role: 'assistant',
          status: 'completed',
          source: 'sync-gateway',
          sessionKey,
        }),
        workspaceId
      )

    const row = db
      .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
      .get(replyInsert.lastInsertRowid, workspaceId) as Message

    eventBus.broadcast('chat.message', {
      ...row,
      metadata: safeParseMetadata(row.metadata),
    })

    return NextResponse.json({ ok: true, inserted: true, messageId: row.id }, { status: 200 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/messages/sync-gateway error')
    return NextResponse.json({ ok: false, error: 'sync_failed' }, { status: 500 })
  }
}
