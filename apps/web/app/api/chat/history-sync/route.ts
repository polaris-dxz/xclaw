import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getAllGatewaySessions } from '@/lib/sessions'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { logger } from '@/lib/logger'
import { config } from '@/lib/config'
import {
  parseGatewayHistoryTranscript,
  parseJsonlTranscript,
  readSessionJsonl,
  type TranscriptMessage,
} from '@/lib/transcript-parser'
import {
  conversationHasStoredAttachments,
  transcriptToGatewaySqliteRows,
  type GatewaySqliteInsertableMessage,
} from '@/lib/chat-messages/gateway-jsonl-sqlite-sync'

async function readTranscript(sessionKey: string, sessionAgent: string, sessionId: string, limit: number) {
  try {
    const history = await callOpenClawGateway<{ messages?: unknown[] }>(
      'chat.history',
      { sessionKey, limit },
      15000,
    )
    const liveMessages = parseGatewayHistoryTranscript(Array.isArray(history?.messages) ? history.messages : [], limit)
    if (liveMessages.length > 0) return liveMessages
  } catch {
    // fallback to disk transcript
  }

  const stateDir = config.openclawStateDir
  if (!stateDir) return []
  const raw = readSessionJsonl(stateDir, sessionAgent, sessionId)
  if (!raw) return []
  return parseJsonlTranscript(raw, limit)
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json().catch(() => ({}))
    const limitSessions = Math.max(1, Math.min(Number(body?.limitSessions || 30), 100))
    const limitMessages = Math.max(20, Math.min(Number(body?.limitMessages || 200), 500))

    const sessions = getAllGatewaySessions(365 * 24 * 60 * 60 * 1000, true).slice(0, limitSessions)
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const hiddenConversationIds = new Set(
      (db
        .prepare('SELECT conversation_id FROM hidden_conversations WHERE workspace_id = ?')
        .all(workspaceId) as Array<{ conversation_id: string }>)
        .map((row) => row.conversation_id)
    )

    const deleteStmt = db.prepare('DELETE FROM messages WHERE conversation_id = ? AND workspace_id = ?')
    const insertStmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id, openclaw_event_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    let importedConversations = 0
    let importedMessages = 0

    for (const session of sessions) {
      const transcript = await readTranscript(session.key, session.agent, session.sessionId, limitMessages)
      if (transcript.length === 0) continue

      const conversationId = `gw:${session.key}`
      if (hiddenConversationIds.has(conversationId)) continue
      /** 侧栏 loadRemote 会触发本同步；若本地已有带附件的用户消息，整段 DELETE 会清掉附件展示，故跳过该会话 */
      if (conversationHasStoredAttachments(db, conversationId, workspaceId)) {
        continue
      }
      const baseTsSec = Math.max(1, Math.floor((session.updatedAt || Date.now()) / 1000) - transcript.length)
      const mapped: GatewaySqliteInsertableMessage[] = transcriptToGatewaySqliteRows(
        conversationId,
        session.agent,
        session.key,
        transcript,
        baseTsSec,
        'gateway-history',
      )
      if (mapped.length === 0) continue

      deleteStmt.run(conversationId, workspaceId)
      for (const item of mapped) {
        insertStmt.run(
          item.conversationId,
          item.from,
          item.to,
          item.content,
          item.messageType,
          item.metadata ? JSON.stringify(item.metadata) : null,
          workspaceId,
          item.openclawEventJson,
          item.createdAt,
        )
      }

      importedConversations += 1
      importedMessages += mapped.length
    }

    return NextResponse.json({
      ok: true,
      scannedSessions: sessions.length,
      importedConversations,
      importedMessages,
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/history-sync error')
    return NextResponse.json({ error: 'Failed to sync gateway history' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
