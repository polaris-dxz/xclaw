import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'
import { getAllGatewaySessions, invalidateSessionCache } from '@/lib/sessions'
import {
  conversationHasStoredAttachments,
  replaceGatewayConversationFromDiskJsonl,
} from '@/lib/chat-messages/gateway-jsonl-sqlite-sync'

/** 与 sessions API 一致，避免畸形 key */
const SESSION_KEY_RE = /^[a-zA-Z0-9:_.-]+$/

type DetailRow = {
  conversation_id: string
  sessionKey: string
  ok: boolean
  reason?: string
  inserted?: number
}

/**
 * POST /api/chat/messages/rebuild-from-jsonl
 *
 * 按磁盘 `~/.xclaw/agents/<agent>/sessions/<sessionId>.jsonl` 覆盖 SQLite 中对应 `gw:<sessionKey>` 会话的消息（DELETE 后全量 INSERT）。
 * 用于修复错误落库数据；不调用 chat.history。
 *
 * Body（可选）:
 * - `conversation_id`: `"gw:agent:..."` — 仅重建该会话；省略则扫描本地 session 列表批量重建（受 `limit_sessions` 限制）。
 * - `jsonl_limit`: 默认 5000，上限 20000（parseJsonlTranscript 截断）。
 * - `max_read_attempts`: 默认 1（管理性批量刷盘）；发消息后同步仍由其它路径使用较大重试。
 * - `limit_sessions`: 批量时最多处理多少个 session，默认 200，上限 500。
 * - `force`: `true` 时忽略「会话含本地上传附件 metadata」保护（会删掉附件行，慎用）。
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const conversationIdRaw = typeof body.conversation_id === 'string' ? body.conversation_id.trim() : ''
  const force = body.force === true
  const jsonlLimit = Number.isFinite(Number(body.jsonl_limit))
    ? Math.max(100, Math.min(Number(body.jsonl_limit), 20_000))
    : 5000
  const maxReadAttempts = Number.isFinite(Number(body.max_read_attempts))
    ? Math.max(1, Math.min(Number(body.max_read_attempts), 30))
    : 1
  const limitSessions = Number.isFinite(Number(body.limit_sessions))
    ? Math.max(1, Math.min(Number(body.limit_sessions), 500))
    : 200

  const db = getDatabase()
  const workspaceId = auth.user.workspace_id ?? 1

  const hiddenConversationIds = new Set(
    (db
      .prepare('SELECT conversation_id FROM hidden_conversations WHERE workspace_id = ?')
      .all(workspaceId) as Array<{ conversation_id: string }>)
      .map((row) => row.conversation_id),
  )

  const details: DetailRow[] = []

  const shouldSkipAttachments = (conversationId: string) =>
    !force && conversationHasStoredAttachments(db, conversationId, workspaceId)

  if (conversationIdRaw) {
    if (!conversationIdRaw.startsWith('gw:')) {
      return NextResponse.json({ error: 'conversation_id must start with gw:' }, { status: 400 })
    }
    const sessionKey = conversationIdRaw.slice(3).trim()
    if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
      return NextResponse.json({ error: 'Invalid gateway conversation_id' }, { status: 400 })
    }
    if (hiddenConversationIds.has(conversationIdRaw)) {
      return NextResponse.json({ error: 'conversation is hidden', conversation_id: conversationIdRaw }, { status: 400 })
    }
    if (shouldSkipAttachments(conversationIdRaw)) {
      return NextResponse.json(
        {
          error: 'skipped: conversation has local attachments in metadata (pass force:true to override)',
          conversation_id: conversationIdRaw,
        },
        { status: 409 },
      )
    }
    const r = await replaceGatewayConversationFromDiskJsonl(db, workspaceId, conversationIdRaw, sessionKey, {
      jsonlLimit,
      maxReadAttempts,
      force,
    })
    details.push({
      conversation_id: conversationIdRaw,
      sessionKey,
      ok: r.ok,
      reason: r.reason,
      inserted: r.inserted,
    })
    const rebuilt = r.ok ? 1 : 0
    const totalRows = r.inserted ?? 0
    logger.info(
      { workspaceId, mode: 'single', conversationId: conversationIdRaw, rebuilt, totalRows, force },
      'POST /api/chat/messages/rebuild-from-jsonl',
    )
    return NextResponse.json({ ok: true, scanned: 1, rebuilt, skipped: 0, totalRows, details })
  }

  invalidateSessionCache()
  const sessions = getAllGatewaySessions(365 * 24 * 60 * 60 * 1000, true).slice(0, limitSessions)
  let rebuilt = 0
  let skipped = 0
  let totalRows = 0

  for (const session of sessions) {
    const conversationId = `gw:${session.key}`
    if (hiddenConversationIds.has(conversationId)) {
      skipped += 1
      details.push({ conversation_id: conversationId, sessionKey: session.key, ok: false, reason: 'hidden' })
      continue
    }
    if (shouldSkipAttachments(conversationId)) {
      skipped += 1
      details.push({
        conversation_id: conversationId,
        sessionKey: session.key,
        ok: false,
        reason: 'has_attachments_skip',
      })
      continue
    }
    const r = await replaceGatewayConversationFromDiskJsonl(db, workspaceId, conversationId, session.key, {
      jsonlLimit,
      maxReadAttempts,
      force,
    })
    if (r.ok) rebuilt += 1
    else skipped += 1
    if (typeof r.inserted === 'number') totalRows += r.inserted
    details.push({
      conversation_id: conversationId,
      sessionKey: session.key,
      ok: r.ok,
      reason: r.reason,
      inserted: r.inserted,
    })
  }

  logger.info(
    { workspaceId, mode: 'bulk', scanned: sessions.length, rebuilt, skipped, totalRows, force },
    'POST /api/chat/messages/rebuild-from-jsonl',
  )

  return NextResponse.json({
    ok: true,
    scanned: sessions.length,
    rebuilt,
    skipped,
    totalRows,
    details,
  })
}

export const dynamic = 'force-dynamic'
