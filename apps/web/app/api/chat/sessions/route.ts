import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { mutationLimiter } from '@/lib/rate-limit'
import { callOpenClawGateway, unwrapGatewayRpcResult } from '@/lib/openclaw-gateway'
import { logger } from '@/lib/logger'
import { isGatewayDuplicateLabelError, MAX_LABEL, truncateSessionLabel } from '@/lib/session-label'
import { loadModelStoreState } from '@/lib/openclaw-model-store'

/** 新建 gw 会话时尚无首条消息，API 返回给前端的占位名（真正标题在首条用户消息里写入 Gateway） */
const PLACEHOLDER_SESSION_LABEL = '新对话'

/** 与 DELETE /api/sessions 等路由一致，允许 OpenClaw canonical session key 字符集 */
const SESSION_KEY_RE = /^[a-zA-Z0-9:_.-]+$/

function buildUiBranchSessionKey(): string {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 16)
  return `agent:main:ui-${suffix}`
}

/**
 * 对已有 session 写入 label（sessions.patch），label 冲突时自动追加 (2)、(3)。
 */
async function applyLabelToExistingSession(
  sessionKey: string,
  rawLabel: string,
): Promise<{ key: string; label: string; entry?: unknown }> {
  const baseLabel = truncateSessionLabel(rawLabel)
  if (!baseLabel) {
    throw new Error('Invalid label')
  }

  let labelToApply = baseLabel
  let canonicalKey = sessionKey
  let labeled: {
    ok?: boolean
    key?: string
    entry?: { label?: string } | null
  } | null = null

  for (let attempt = 0; attempt < 11; attempt++) {
    try {
      labeled = unwrapGatewayRpcResult<{
        ok?: boolean
        key?: string
        entry?: { label?: string } | null
      }>(
        await callOpenClawGateway('sessions.patch', { key: canonicalKey, label: labelToApply }, 15_000),
      )
    } catch (e) {
      if (attempt < 10 && isGatewayDuplicateLabelError(e)) {
        labelToApply = truncateSessionLabel(`${baseLabel} (${attempt + 2})`, MAX_LABEL)
        continue
      }
      throw e
    }

    if (labeled && typeof labeled === 'object' && (labeled as { ok?: boolean }).ok === false) {
      throw new Error('Gateway rejected session label')
    }
    break
  }

  canonicalKey =
    typeof labeled?.key === 'string' && labeled.key.trim() ? labeled.key.trim() : canonicalKey

  return { key: canonicalKey, label: labelToApply, entry: labeled?.entry ?? undefined }
}

/**
 * PATCH /api/chat/sessions — 更新已有 Gateway session 的展示标题（sessions.patch label），供侧栏重命名同步。
 *
 * Body: `{ conversation_id: "gw:…" }` 或 `{ sessionKey: "agent:…" }`，以及 `label: string`（1–64 字）。
 */
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawLabel = typeof body.label === 'string' ? body.label : ''
  const rawConv = typeof body.conversation_id === 'string' ? body.conversation_id.trim() : ''
  const rawKey = typeof body.sessionKey === 'string' ? body.sessionKey.trim() : ''

  let sessionKey = rawKey
  if (!sessionKey && rawConv.startsWith('gw:')) {
    sessionKey = rawConv.slice(3).trim()
  }

  if (!sessionKey || !SESSION_KEY_RE.test(sessionKey)) {
    return NextResponse.json({ error: 'Invalid session key or conversation_id' }, { status: 400 })
  }

  try {
    const result = await applyLabelToExistingSession(sessionKey, rawLabel)
    return NextResponse.json({
      conversation_id: `gw:${result.key}`,
      sessionKey: result.key,
      label: result.label,
      entry: result.entry ?? null,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update session label'
    if (message === 'Invalid label') {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    if (message === 'Gateway rejected session label') {
      return NextResponse.json({ error: message }, { status: 502 })
    }
    logger.error({ err: error }, 'PATCH /api/chat/sessions failed')
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

/**
 * POST /api/chat/sessions — 在 Gateway 上登记一条新的 agent-scoped session（OpenClaw 无独立 create RPC 时，
 * 通过对新 key 调用 `sessions.patch` 写入 session store，等价于新建线程）。
 *
 * Body（可选）: `{ mainKey?: string, label?: string }` — 省略 `label` 时不在 Gateway 写入展示标题（首条用户消息会用问题正文 `sessions.patch`）；仅当调用方显式传 `label` 时才写入并处理冲突重试。
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  // Setup Gate backend safety net:
  // If no default model is configured, we should not allow creating new chat sessions
  // because downstream calls depend on an effective model.
  try {
    const state = loadModelStoreState('main')
    if (!state?.primary || !String(state.primary).trim()) {
      return NextResponse.json(
        {
          error: '默认模型未配置，请先完成模型选择',
          code: 'MODEL_NOT_CONFIGURED',
          setupPath: '/setup/models',
        },
        { status: 428 },
      )
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: '无法读取模型配置，请先完成模型选择',
        code: 'MODEL_CONFIG_UNAVAILABLE',
        setupPath: '/setup/models',
      },
      { status: 428 },
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const rawMain = typeof body.mainKey === 'string' ? body.mainKey.trim() : ''
  const sanitizedMain = rawMain
    ? rawMain
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || null
    : null

  const sessionKey = sanitizedMain ? `agent:main:${sanitizedMain}` : buildUiBranchSessionKey()

  if (!SESSION_KEY_RE.test(sessionKey)) {
    return NextResponse.json({ error: 'Invalid session key format' }, { status: 400 })
  }

  const rawLabel = typeof body.label === 'string' ? body.label.trim() : ''

  try {
    // 部分 Gateway 版本在同一次 patch 里「新建 + label」时 label 不落库；显式 label 时先建会话再写 label。
    const created = unwrapGatewayRpcResult<{
      ok?: boolean
      key?: string
      entry?: unknown
    }>(
      await callOpenClawGateway('sessions.patch', { key: sessionKey }, 15_000),
    )

    if (created && typeof created === 'object' && (created as { ok?: boolean }).ok === false) {
      return NextResponse.json({ error: 'Gateway rejected session creation' }, { status: 502 })
    }

    let canonicalKey =
      typeof created?.key === 'string' && created.key.trim() ? created.key.trim() : sessionKey

    if (!rawLabel) {
      return NextResponse.json({
        conversation_id: `gw:${canonicalKey}`,
        sessionKey: canonicalKey,
        label: PLACEHOLDER_SESSION_LABEL,
        entry: created?.entry ?? null,
      })
    }

    try {
      const result = await applyLabelToExistingSession(canonicalKey, rawLabel)
      return NextResponse.json({
        conversation_id: `gw:${result.key}`,
        sessionKey: result.key,
        label: result.label,
        entry: result.entry ?? created?.entry ?? null,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gateway rejected session label'
      if (msg === 'Invalid label') {
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      if (msg === 'Gateway rejected session label') {
        return NextResponse.json({ error: msg }, { status: 502 })
      }
      throw e
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create gateway session'
    logger.error({ err: error }, 'POST /api/chat/sessions failed')
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export const dynamic = 'force-dynamic'
