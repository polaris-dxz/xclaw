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

type InsertableMessage = {
  conversationId: string
  from: string
  to: string | null
  content: string
  messageType: 'text' | 'status' | 'tool_call'
  metadata?: Record<string, unknown>
  createdAt: number
}

function toUnixSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const ms = Date.parse(value)
  if (!Number.isFinite(ms) || ms <= 0) return fallback
  return Math.floor(ms / 1000)
}

function normalizeText(text: string): string {
  return String(text || '').trim().slice(0, 8000)
}

/** 解析 messages.metadata；用于判断会话是否含本地上传的附件（勿整段 DELETE，否则会抹掉 dataUrl） */
function parseMetadataObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function conversationHasStoredAttachments(
  db: ReturnType<typeof getDatabase>,
  conversationId: string,
  workspaceId: number,
): boolean {
  const rows = db
    .prepare(
      `SELECT metadata FROM messages WHERE conversation_id = ? AND workspace_id = ? ORDER BY id DESC LIMIT 120`,
    )
    .all(conversationId, workspaceId) as Array<{ metadata: string | null }>
  for (const row of rows) {
    const meta = parseMetadataObject(row.metadata)
    if (!meta) continue
    const att = meta.attachments
    if (Array.isArray(att) && att.length > 0) return true
  }
  return false
}

function transcriptToMessages(
  conversationId: string,
  sessionAgent: string,
  sessionKey: string,
  transcript: TranscriptMessage[],
  baseTimestampSec: number,
): InsertableMessage[] {
  const out: InsertableMessage[] = []

  transcript.forEach((entry, index) => {
    const timestamp = toUnixSeconds(entry.timestamp, baseTimestampSec + index)
    const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'system' ? 'system' : 'user'
    const from = role === 'assistant' ? sessionAgent : role === 'system' ? 'system' : 'user'
    const to = role === 'assistant' ? 'user' : sessionAgent

    for (const part of entry.parts) {
      if (part.type === 'text') {
        const text = normalizeText(part.text)
        if (!text) continue
        out.push({
          conversationId,
          from,
          to,
          content: text,
          messageType: 'text',
          metadata: { source: 'gateway-history', sessionKey, role },
          createdAt: timestamp,
        })
        continue
      }

      if (part.type === 'thinking') {
        const thinking = normalizeText(part.thinking)
        if (!thinking) continue
        out.push({
          conversationId,
          from: sessionAgent,
          to: 'user',
          content: thinking,
          messageType: 'status',
          metadata: { source: 'gateway-history', sessionKey, event: 'thinking' },
          createdAt: timestamp,
        })
        continue
      }

      if (part.type === 'tool_use') {
        out.push({
          conversationId,
          from: sessionAgent,
          to: 'user',
          content: part.name || 'tool_use',
          messageType: 'tool_call',
          metadata: {
            source: 'gateway-history',
            sessionKey,
            event: 'tool_call',
            toolName: part.name || 'tool_use',
            input: part.input || '',
            status: 'running',
            toolUseId: part.id || '',
          },
          createdAt: timestamp,
        })
        continue
      }

      if (part.type === 'tool_result') {
        out.push({
          conversationId,
          from: sessionAgent,
          to: 'user',
          content: `tool_result:${part.toolUseId || 'unknown'}`,
          messageType: 'tool_call',
          metadata: {
            source: 'gateway-history',
            sessionKey,
            event: 'tool_call',
            toolName: 'tool_result',
            output: part.content || '',
            status: part.isError ? 'error' : 'ok',
            toolUseId: part.toolUseId || '',
          },
          createdAt: timestamp,
        })
      }
    }
  })

  return out
}

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
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
      const mapped = transcriptToMessages(conversationId, session.agent, session.key, transcript, baseTsSec)
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
