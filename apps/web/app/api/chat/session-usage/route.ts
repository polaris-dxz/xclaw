import { NextRequest, NextResponse } from 'next/server'
import { getAllGatewaySessions } from '@/lib/sessions'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

/** 与侧栏 sessions 映射一致：未写入 contextTokens 时用常见默认便于展示比例 */
const DEFAULT_CONTEXT_FALLBACK = 128_000

/**
 * GET /api/chat/session-usage?conversation_id=gw:...
 * 从 OpenClaw 本地 session store 读取当前会话的 token 累计与上下文上限（与网关侧栏同源）。
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const cid = String(request.nextUrl.searchParams.get('conversation_id') || '').trim()
  if (!cid.startsWith('gw:')) {
    return NextResponse.json({
      ok: true,
      available: false,
      reason: 'not_gateway_session',
    })
  }

  const key = cid.slice(3).trim()
  if (!key) {
    return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })
  }

  try {
    const sessions = getAllGatewaySessions(60 * 60 * 1000, true)
    const hit = sessions.find((s) => s.key === key)
    if (!hit) {
      const db = getDatabase()
      const workspaceId = auth.user.workspace_id ?? 1
      const row = db
        .prepare(
          'SELECT COUNT(*) as c FROM messages WHERE conversation_id = ? AND workspace_id = ?',
        )
        .get(cid, workspaceId) as { c: number }
      const localMessageCount = Number(row?.c ?? 0)
      return NextResponse.json({
        ok: true,
        available: false,
        reason: 'session_not_found',
        localMessageCount,
        /** 网关上已无 session，且本地 DB 也无消息 → 侧栏应移除幽灵 gw: 项 */
        orphanShouldHide: localMessageCount === 0,
      })
    }

    const used = Number(hit.totalTokens || 0)
    const rawLimit = Number(hit.contextTokens || 0)
    const contextLimit = rawLimit > 0 ? rawLimit : DEFAULT_CONTEXT_FALLBACK
    const contextIsEstimated = rawLimit <= 0
    const pct =
      contextLimit > 0 ? Math.min(100, Math.round((used / contextLimit) * 100)) : null

    return NextResponse.json({
      ok: true,
      available: true,
      key: hit.key,
      model: hit.model || null,
      used,
      /** 用于「总量」展示的上下文窗口上限；若磁盘未写 contextTokens 则为默认 128k 并标记 estimated */
      contextLimit,
      contextIsEstimated,
      inputTokens: Number(hit.inputTokens || 0),
      outputTokens: Number(hit.outputTokens || 0),
      pct,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/session-usage')
    return NextResponse.json({ error: 'Failed to read session usage' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
