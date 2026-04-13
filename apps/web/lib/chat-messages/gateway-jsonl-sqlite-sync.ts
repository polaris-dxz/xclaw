import type { Database } from 'better-sqlite3'
import { setTimeout as delay } from 'node:timers/promises'
import { config } from '@/lib/config'
import { logger } from '@/lib/logger'
import { getAllGatewaySessions, invalidateSessionCache } from '@/lib/sessions'
import {
  parseJsonlTranscript,
  readSessionJsonl,
  type TranscriptMessage,
} from '@/lib/transcript-parser'
import { openclawEventJsonStringForTranscriptRow } from '@/lib/chat-messages/openclaw-event-shape'
import { stripUntrustedSenderMetadataEnvelope } from '@/lib/chat-messages/untrusted-sender-envelope'

export type GatewaySqliteInsertableMessage = {
  conversationId: string
  from: string
  to: string | null
  content: string
  messageType: 'text' | 'status' | 'tool_call'
  metadata?: Record<string, unknown>
  createdAt: number
  openclawEventJson: string
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

function parseMetadataObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function conversationHasStoredAttachments(
  db: Database.Database,
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

/**
 * 将 parseJsonlTranscript / parseGatewayHistoryTranscript 的结果展开为与 history-sync 一致的 SQLite 行。
 */
export function transcriptToGatewaySqliteRows(
  conversationId: string,
  sessionAgent: string,
  sessionKey: string,
  transcript: TranscriptMessage[],
  baseTimestampSec: number,
  metadataSource: string,
): GatewaySqliteInsertableMessage[] {
  const out: GatewaySqliteInsertableMessage[] = []

  transcript.forEach((entry, index) => {
    const timestamp = toUnixSeconds(entry.timestamp, baseTimestampSec + index)
    const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'system' ? 'system' : 'user'
    const from = role === 'assistant' ? sessionAgent : role === 'system' ? 'system' : 'user'
    const to = role === 'assistant' ? 'user' : sessionAgent

    for (const part of entry.parts) {
      if (part.type === 'text') {
        const rawText = from === 'user' ? stripUntrustedSenderMetadataEnvelope(part.text) : part.text
        const text = normalizeText(rawText)
        if (!text) continue
        out.push({
          conversationId,
          from,
          to,
          content: text,
          messageType: 'text',
          metadata: { source: metadataSource, sessionKey, role },
          createdAt: timestamp,
          openclawEventJson: openclawEventJsonStringForTranscriptRow(entry, part),
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
          metadata: { source: metadataSource, sessionKey, event: 'thinking' },
          createdAt: timestamp,
          openclawEventJson: openclawEventJsonStringForTranscriptRow(entry, part),
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
            source: metadataSource,
            sessionKey,
            event: 'tool_call',
            toolName: part.name || 'tool_use',
            input: part.input || '',
            status: 'running',
            toolUseId: part.id || '',
          },
          createdAt: timestamp,
          openclawEventJson: openclawEventJsonStringForTranscriptRow(entry, part),
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
            source: metadataSource,
            sessionKey,
            event: 'tool_call',
            toolName: 'tool_result',
            output: part.content || '',
            status: part.isError ? 'error' : 'ok',
            toolUseId: part.toolUseId || '',
          },
          createdAt: timestamp,
          openclawEventJson: openclawEventJsonStringForTranscriptRow(entry, part),
        })
      }
    }
  })

  return out
}

export type ReplaceFromJsonlResult = {
  ok: boolean
  reason?: string
  inserted?: number
}

const DEFAULT_JSONL_LIMIT = 2500
const RETRY_MS = 180
const DEFAULT_MAX_READ_ATTEMPTS = 14

/**
 * 以磁盘 `sessions/<sessionId>.jsonl` 为权威：删除该会话在 SQLite 中的行后按 jsonl 全量重写。
 * 不调用 chat.history，与 OpenClaw 落盘一致。
 *
 * 含本地上传附件的会话会跳过（与 history-sync 相同），避免删掉 dataUrl。
 */
export async function replaceGatewayConversationFromDiskJsonl(
  db: Database.Database,
  workspaceId: number,
  conversationId: string,
  sessionKey: string,
  opts?: { jsonlLimit?: number; maxReadAttempts?: number; force?: boolean },
): Promise<ReplaceFromJsonlResult> {
  if (!conversationId.startsWith('gw:')) {
    return { ok: false, reason: 'not_gateway_conversation' }
  }

  if (!opts?.force && conversationHasStoredAttachments(db, conversationId, workspaceId)) {
    return { ok: false, reason: 'has_attachments_skip' }
  }

  const stateDir = config.openclawStateDir
  if (!stateDir) {
    return { ok: false, reason: 'no_openclaw_state_dir' }
  }

  invalidateSessionCache()
  const session = getAllGatewaySessions(365 * 24 * 60 * 60 * 1000, true).find((s) => s.key === sessionKey)
  if (!session?.sessionId) {
    return { ok: false, reason: 'session_not_found' }
  }

  const limit = opts?.jsonlLimit ?? DEFAULT_JSONL_LIMIT
  const maxAttempts = Math.max(1, Math.min(opts?.maxReadAttempts ?? DEFAULT_MAX_READ_ATTEMPTS, 60))
  let mapped: GatewaySqliteInsertableMessage[] = []
  let raw: string | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    raw = readSessionJsonl(stateDir, session.agent, session.sessionId)
    const transcript = raw ? parseJsonlTranscript(raw, limit) : []
    const baseTsSec = Math.max(1, Math.floor((session.updatedAt || Date.now()) / 1000) - transcript.length)
    mapped = transcriptToGatewaySqliteRows(
      conversationId,
      session.agent,
      sessionKey,
      transcript,
      baseTsSec,
      'jsonl-disk-sync',
    )
    if (mapped.length > 0) break
    if (attempt < maxAttempts - 1) {
      await delay(RETRY_MS)
    }
  }

  if (mapped.length === 0) {
    logger.warn(
      { conversationId, sessionKey, sessionId: session.sessionId, rawLen: raw?.length ?? 0 },
      'replaceGatewayConversationFromDiskJsonl: empty transcript after retries, keeping SQLite',
    )
    return { ok: false, reason: 'empty_jsonl_after_retries' }
  }

  const deleteStmt = db.prepare('DELETE FROM messages WHERE conversation_id = ? AND workspace_id = ?')
  const insertStmt = db.prepare(`
    INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id, openclaw_event_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const run = db.transaction(() => {
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
  })
  run()

  logger.info(
    { conversationId, sessionKey, inserted: mapped.length },
    'replaceGatewayConversationFromDiskJsonl: sqlite replaced from jsonl',
  )

  return { ok: true, inserted: mapped.length }
}
