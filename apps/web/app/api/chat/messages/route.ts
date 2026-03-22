import { Buffer } from 'node:buffer'
import mammoth from 'mammoth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, Message } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { getAllGatewaySessions } from '@/lib/sessions'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { scanForInjection, sanitizeForPrompt } from '@/lib/injection-guard'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { resolveCoordinatorDeliveryTarget } from '@/lib/coordinator-routing'
import { readLatestAssistantReplyFromHistory } from '@/lib/openclaw-chat-history'

type ForwardInfo = {
  attempted: boolean
  delivered: boolean
  reason?: string
  session?: string
  runId?: string
  /** 服务端已完成本轮同步等待（agent.wait 等），客户端不应再进入「等待回复」竞态 */
  completed?: boolean
}

type ToolEvent = {
  name: string
  input?: string
  output?: string
  status?: string
}

type ChatAttachmentInput = {
  name?: string
  type?: string
  dataUrl?: string
  size?: number
}

const COORDINATOR_AGENT =
  String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').trim() ||
  'coordinator'

function parseGatewayJson(raw: string): any | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

/** OpenClaw chat.send：图片用 image，其它二进制用 file（网关侧多模态/解析） */
type GatewayAttachmentPart =
  | { type: 'image'; mimeType: string; fileName?: string; content: string }
  | { type: 'file'; mimeType: string; fileName?: string; content: string }

/** 解析 data URL（兼容 `data:image/png;charset=utf-8;base64,...`） */
function parseDataUrlBase64(dataUrl: string): { mimeType: string; base64: string } | null {
  if (!dataUrl.startsWith('data:')) return null
  const marker = ';base64,'
  const idx = dataUrl.indexOf(marker)
  if (idx < 0) return null
  const header = dataUrl.slice('data:'.length, idx)
  const base64 = dataUrl.slice(idx + marker.length)
  if (!header || !base64) return null
  const mimeType = header.split(';')[0].trim() || 'application/octet-stream'
  return { mimeType, base64 }
}

/** 文本类附件会内联进 message；发往网关时可不再重复传 file，减轻体积并避免 OpenClaw 未消费 file 附件 */
function isTextLikeMime(mimeType: string): boolean {
  const m = mimeType.toLowerCase().split(';')[0].trim()
  if (m.startsWith('text/')) return true
  if (m === 'application/json' || m === 'application/javascript') return true
  if (m.endsWith('+json') || m.endsWith('+xml')) return true
  return false
}

const MAX_INLINE_TEXT_CHARS = 200_000

/** Word：服务端提取正文后不再把整份 base64 塞进 `openclaw gateway call --params`（避免 ARG_MAX 导致投递失败） */
const WORD_DOC_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
])

/**
 * 从 Word 文档提取纯文本并拼入 gateway 消息；成功提取的文件名加入 excluded，后续不再作为 file 附件转发。
 */
async function appendDocxTextFromAttachments(
  base: string,
  attachments: Array<{ name: string; type: string; dataUrl: string }> | undefined,
): Promise<{ message: string; excludedFileNames: Set<string> }> {
  const excludedFileNames = new Set<string>()
  if (!attachments?.length) return { message: base, excludedFileNames }

  const chunks: string[] = []
  for (const att of attachments) {
    const mime = (att.type || '').toLowerCase().split(';')[0].trim()
    if (!WORD_DOC_MIMES.has(mime)) continue
    const parsed = parseDataUrlBase64(att.dataUrl)
    if (!parsed) continue
    try {
      const buf = Buffer.from(parsed.base64, 'base64')
      const result = await mammoth.extractRawText({ buffer: buf })
      let text = (result.value || '').trim()
      if (!text) {
        logger.warn({ name: att.name }, 'Word 附件无法提取正文（空内容），仍将尝试原样转发')
        continue
      }
      if (text.length > MAX_INLINE_TEXT_CHARS) {
        text = `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n[... 内容已截断 ...]`
      }
      chunks.push(`\n\n---\n【Word「${att.name}」提取正文】\n${text}`)
      excludedFileNames.add(att.name)
    } catch (err) {
      logger.warn({ err, name: att.name }, 'Word 附件正文提取失败，仍将尝试原样转发')
    }
  }
  if (chunks.length === 0) return { message: base, excludedFileNames }
  return { message: `${base}${chunks.join('')}`, excludedFileNames }
}

/**
 * 将 text/markdown、json 等解码进用户消息，模型侧一定能读到（不依赖网关 multimodal）。
 */
function appendInlinedTextFromAttachments(
  base: string,
  attachments: Array<{ name: string; type: string; dataUrl: string }> | undefined,
): string {
  if (!attachments?.length) return base
  const chunks: string[] = []
  for (const att of attachments) {
    const parsed = parseDataUrlBase64(att.dataUrl)
    if (!parsed) continue
    const mime = (parsed.mimeType || att.type || '').toLowerCase()
    if (!isTextLikeMime(mime)) continue
    try {
      let text = Buffer.from(parsed.base64, 'base64').toString('utf8')
      if (text.length > MAX_INLINE_TEXT_CHARS) {
        text = `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n[... 内容已截断 ...]`
      }
      chunks.push(`\n\n---\n【附件「${att.name}」】\n${text}`)
    } catch {
      continue
    }
  }
  if (chunks.length === 0) return base
  return `${base}${chunks.join('')}`
}

function toGatewayAttachments(
  value: unknown,
  opts?: { excludeTextLike?: boolean; excludeFileNames?: Set<string> },
): GatewayAttachmentPart[] | undefined {
  if (!Array.isArray(value)) return undefined

  const out: GatewayAttachmentPart[] = []
  for (const entry of value) {
    const file = entry as ChatAttachmentInput
    if (!file || typeof file !== 'object' || typeof file.dataUrl !== 'string') continue
    const fileName = typeof file.name === 'string' ? file.name : ''
    if (fileName && opts?.excludeFileNames?.has(fileName)) continue
    const parsed = parseDataUrlBase64(file.dataUrl)
    if (!parsed) continue
    const { mimeType, base64: content } = parsed
    if (opts?.excludeTextLike && isTextLikeMime(mimeType)) continue
    const base = {
      mimeType,
      fileName: typeof file.name === 'string' ? file.name : undefined,
      content,
    }
    if (mimeType.startsWith('image/')) {
      out.push({ type: 'image', ...base })
    } else {
      out.push({ type: 'file', ...base })
    }
  }

  return out.length > 0 ? out : undefined
}

/** 用户未输入正文、仅附件时，发给网关的提示（避免 message 为空） */
const GATEWAY_ATTACHMENT_ONLY_HINT = '（用户上传了附件，请根据附件内容处理。）'

function normalizeMessageAttachments(value: unknown): Array<{ name: string; type: string; size: number; dataUrl: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const cleaned = value
    .slice(0, 8)
    .flatMap((entry) => {
      const file = entry as ChatAttachmentInput
      if (!file || typeof file !== 'object' || typeof file.dataUrl !== 'string') return []
      if (!file.dataUrl.startsWith('data:')) return []
      const name = typeof file.name === 'string' && file.name.trim() ? file.name.trim().slice(0, 120) : 'attachment'
      const type = typeof file.type === 'string' && file.type.trim() ? file.type.trim().slice(0, 120) : 'application/octet-stream'
      const size = Number(file.size || 0)
      return [{ name, type, size: Number.isFinite(size) && size >= 0 ? size : 0, dataUrl: file.dataUrl }]
    })
  return cleaned.length > 0 ? cleaned : undefined
}

function safeParseMetadata(raw: string | null | undefined): any | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function createChatReply(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  conversationId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  messageType: 'text' | 'status' | 'tool_call' = 'status',
  metadata: Record<string, any> | null = null
) {
  const replyInsert = db
    .prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      conversationId,
      fromAgent,
      toAgent,
      content,
      messageType,
      metadata ? JSON.stringify(metadata) : null,
      workspaceId
    )

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
    .get(replyInsert.lastInsertRowid, workspaceId) as Message

  eventBus.broadcast('chat.message', {
    ...row,
    metadata: safeParseMetadata(row.metadata),
  })
}

function withPhase(
  phase: 'thinking' | 'final' | 'error',
  meta: Record<string, any> | null = null
): Record<string, any> {
  return { ...(meta || {}), phase }
}

function extractReplyText(waitPayload: any): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null

  const directCandidates = [
    waitPayload.text,
    waitPayload.message,
    waitPayload.response,
    waitPayload.output,
    waitPayload.result,
  ]
  for (const value of directCandidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  if (typeof waitPayload.output === 'object' && waitPayload.output) {
    const nested = [
      waitPayload.output.text,
      waitPayload.output.message,
      waitPayload.output.content,
    ]
    for (const value of nested) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }

  if (Array.isArray(waitPayload.output)) {
    const parts: string[] = []
    for (const item of waitPayload.output) {
      if (!item || typeof item !== 'object') continue
      if (typeof item.text === 'string' && item.text.trim()) parts.push(item.text.trim())
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          if (!block || typeof block !== 'object') continue
          const blockType = String(block.type || '')
          if ((blockType === 'text' || blockType === 'output_text' || blockType === 'input_text') && typeof block.text === 'string' && block.text.trim()) {
            parts.push(block.text.trim())
          }
        }
      }
    }
    if (parts.length > 0) return parts.join('\n').slice(0, 8000)
  }

  return null
}

function normalizeToolEvent(raw: any): ToolEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const name = String(raw.name || raw.tool || raw.toolName || raw.function || raw.call || '').trim()
  if (!name) return null

  const inputRaw = raw.input ?? raw.args ?? raw.arguments ?? raw.params
  const outputRaw = raw.output ?? raw.result ?? raw.response
  const statusRaw =
    raw.status ??
    (raw.isError === true ? 'error' : undefined) ??
    (raw.ok === false ? 'error' : undefined) ??
    (raw.success === true ? 'ok' : undefined)

  const input =
    typeof inputRaw === 'string'
      ? inputRaw.slice(0, 2000)
      : inputRaw !== undefined
        ? JSON.stringify(inputRaw).slice(0, 2000)
        : undefined
  const output =
    typeof outputRaw === 'string'
      ? outputRaw.slice(0, 4000)
      : outputRaw !== undefined
        ? JSON.stringify(outputRaw).slice(0, 4000)
        : undefined
  const status = statusRaw !== undefined ? String(statusRaw).slice(0, 60) : undefined
  return { name, input, output, status }
}

function extractToolEvents(waitPayload: any): ToolEvent[] {
  if (!waitPayload || typeof waitPayload !== 'object') return []

  const candidates = [
    waitPayload.toolCalls,
    waitPayload.tools,
    waitPayload.calls,
    waitPayload.events,
    waitPayload.output?.toolCalls,
    waitPayload.output?.tools,
    waitPayload.output?.events,
  ]

  const events: ToolEvent[] = []
  for (const list of candidates) {
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const evt = normalizeToolEvent(item)
      if (evt) events.push(evt)
      if (events.length >= 20) return events
    }
  }

  // OpenAI Responses-style output array
  if (Array.isArray(waitPayload.output)) {
    for (const item of waitPayload.output) {
      if (!item || typeof item !== 'object') continue
      const itemType = String(item.type || '').toLowerCase()
      if (itemType === 'function_call' || itemType === 'tool_call') {
        const evt = normalizeToolEvent({
          name: item.name || item.tool_name || item.toolName,
          arguments: item.arguments || item.input,
          output: item.output || item.result,
          status: item.status,
        })
        if (evt) events.push(evt)
      } else if (itemType === 'message' && Array.isArray(item.content)) {
        for (const block of item.content) {
          const blockType = String(block?.type || '').toLowerCase()
          if (blockType === 'tool_use' || blockType === 'tool_call' || blockType === 'function_call') {
            const evt = normalizeToolEvent(block)
            if (evt) events.push(evt)
          }
        }
      }
      if (events.length >= 20) return events
    }
  }

  return events
}

/**
 * GET /api/chat/messages - List messages with filters
 * Query params: conversation_id, from_agent, to_agent, limit, offset, since
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const conversation_id = searchParams.get('conversation_id')
    const from_agent = searchParams.get('from_agent')
    const to_agent = searchParams.get('to_agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const since = searchParams.get('since')

    let query = 'SELECT * FROM messages WHERE workspace_id = ?'
    const params: any[] = [workspaceId]

    if (conversation_id) {
      query += ' AND conversation_id = ?'
      params.push(conversation_id)
    }

    if (from_agent) {
      query += ' AND from_agent = ?'
      params.push(from_agent)
    }

    if (to_agent) {
      query += ' AND to_agent = ?'
      params.push(to_agent)
    }

    if (since) {
      query += ' AND created_at > ?'
      params.push(parseInt(since))
    }

    query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const messages = db.prepare(query).all(...params) as Message[]

    const parsed = messages.map((msg) => {
      const metadata = safeParseMetadata(msg.metadata) || {}
      const attachments = Array.isArray((metadata as any).attachments) ? (metadata as any).attachments : undefined
      return {
        ...msg,
        metadata,
        attachments,
      }
    })

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM messages WHERE workspace_id = ?'
    const countParams: any[] = [workspaceId]
    if (conversation_id) {
      countQuery += ' AND conversation_id = ?'
      countParams.push(conversation_id)
    }
    if (from_agent) {
      countQuery += ' AND from_agent = ?'
      countParams.push(from_agent)
    }
    if (to_agent) {
      countQuery += ' AND to_agent = ?'
      countParams.push(to_agent)
    }
    if (since) {
      countQuery += ' AND created_at > ?'
      countParams.push(parseInt(since))
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number }

    return NextResponse.json({ messages: parsed, total: countRow.total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

/**
 * POST /api/chat/messages - Send a new message
 * Body: { to, content, message_type, conversation_id, metadata }
 * Sender identity is always resolved server-side from authenticated user.
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    const requestedFrom = typeof body.from === 'string' ? body.from.trim() : ''
    const isCoordinatorOverride = requestedFrom.toLowerCase() === COORDINATOR_AGENT.toLowerCase()
    const from = isCoordinatorOverride
      ? COORDINATOR_AGENT
      : (auth.user.display_name || auth.user.username || 'system')
    const to = body.to ? (body.to as string).trim() : null
    const userText = (body.content || '').trim()
    const selectedModel = typeof body.model === 'string' ? body.model.trim().slice(0, 120) : ''
    const message_type = body.message_type || 'text'
    const conversation_id = body.conversation_id || `conv_${Date.now()}`
    const attachments = normalizeMessageAttachments(body.attachments)
    /** 存库与展示：无正文时用语义化占位，便于列表与通知 */
    const storedContent =
      userText ||
      (attachments
        ? `[附件] ${attachments.map((a) => a.name).join('，')}`
        : '')
    /** 发给 OpenClaw 的用户消息正文：无正文且仅有附件时用固定提示；文本类附件内联进正文 */
    let gatewayMessage = userText || (attachments ? GATEWAY_ATTACHMENT_ONLY_HINT : '')
    gatewayMessage = appendInlinedTextFromAttachments(gatewayMessage, attachments)
    const docxInline = await appendDocxTextFromAttachments(gatewayMessage, attachments)
    gatewayMessage = docxInline.message
    const docxExcludedNames = docxInline.excludedFileNames
    const agentWaitInnerMs = attachments?.length ? 120_000 : 9_000
    const agentWaitCliMs = agentWaitInnerMs + 15_000
    const chatSendTimeoutMs = attachments?.length ? 120_000 : 12_000
    const metadata = {
      ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
      ...(selectedModel ? { selectedModel } : {}),
      ...(attachments ? { attachments } : {}),
      senderType: 'user',
    }

    if (!userText && !attachments) {
      return NextResponse.json(
        { error: '需要正文或至少一个附件' },
        { status: 400 }
      )
    }

    // Scan user text for injection when it will be forwarded to an agent（纯附件无正文则跳过）
    if (body.forward && to && userText) {
      const injectionReport = scanForInjection(userText, { context: 'prompt' })
      if (!injectionReport.safe) {
        const criticals = injectionReport.matches.filter(m => m.severity === 'critical')
        if (criticals.length > 0) {
          logger.warn({ to, rules: criticals.map(m => m.rule) }, 'Blocked chat message: injection detected')
          return NextResponse.json(
            { error: 'Message blocked: potentially unsafe content detected', injection: criticals.map(m => ({ rule: m.rule, description: m.description })) },
            { status: 422 }
          )
        }
      }
    }

    const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      conversation_id,
      from,
      to,
      storedContent,
      message_type,
      Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      workspaceId
    )

    const messageId = result.lastInsertRowid as number

    let forwardInfo: ForwardInfo | null = null

    // Log activity
    db_helpers.logActivity(
      'chat_message',
      'message',
      messageId,
      from,
      `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`,
      { conversation_id, to, message_type },
      workspaceId
    )

    // Create notification for recipient if specified
    if (to) {
      db_helpers.createNotification(
        to,
        'chat_message',
        `Message from ${from}`,
        storedContent.substring(0, 200) + (storedContent.length > 200 ? '...' : ''),
        'message',
        messageId,
        workspaceId
      )

      // Optionally forward to agent via gateway
      if (body.forward) {
        forwardInfo = { attempted: true, delivered: false }

        const agent = db
          .prepare('SELECT * FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?')
          .get(to, workspaceId) as any

        const gwSessionFromConversation =
          typeof conversation_id === 'string' && conversation_id.startsWith('gw:')
            ? conversation_id.slice(3).trim() || null
            : null
        const explicitSessionKey =
          (typeof body.sessionKey === 'string' && body.sessionKey.trim()
            ? body.sessionKey.trim()
            : gwSessionFromConversation) || null
        const sessions = getAllGatewaySessions()
        const isCoordinatorSend = String(to).toLowerCase() === COORDINATOR_AGENT.toLowerCase()
        const allAgents = isCoordinatorSend
          ? (db
              .prepare('SELECT name, session_key, config FROM agents WHERE workspace_id = ?')
              .all(workspaceId) as Array<{ name: string; session_key?: string | null; config?: string | null }>)
          : []
        const configuredCoordinatorTarget = isCoordinatorSend
          ? (db
              .prepare("SELECT value FROM settings WHERE key = 'chat.coordinator_target_agent'")
              .get() as { value?: string } | undefined)?.value || null
          : null

        const coordinatorResolution = resolveCoordinatorDeliveryTarget({
          to: String(to),
          coordinatorAgent: COORDINATOR_AGENT,
          directAgent: agent
            ? {
                name: String(agent.name || to),
                session_key: typeof agent.session_key === 'string' ? agent.session_key : null,
                config: typeof agent.config === 'string' ? agent.config : null,
              }
            : null,
          allAgents,
          sessions,
          explicitSessionKey,
          configuredCoordinatorTarget,
        })

        // Use explicit session key from caller if provided, then DB, then on-disk lookup
        let sessionKey: string | null = coordinatorResolution.sessionKey

        // Fallback: derive session from on-disk gateway session stores
        if (!sessionKey) {
          const match = sessions.find(
            (s) =>
              s.agent.toLowerCase() === String(to).toLowerCase() ||
              s.agent.toLowerCase() === coordinatorResolution.deliveryName.toLowerCase() ||
              s.agent.toLowerCase() === String(coordinatorResolution.openclawAgentId || '').toLowerCase()
          )
          sessionKey = match?.key || match?.sessionId || null
        }

        // Prefer configured openclawId when present, fallback to normalized name
        let openclawAgentId: string | null = coordinatorResolution.openclawAgentId

        if (!sessionKey && !openclawAgentId) {
          forwardInfo.reason = 'no_active_session'

          // For coordinator messages, emit an immediate visible status reply
          if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
            try {
                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  COORDINATOR_AGENT,
                  from,
                  'I received your message, but my live coordinator session is offline right now. Start/restore the coordinator session and retry.',
                  'status',
                  withPhase('error', { status: 'offline', reason: 'no_active_session' })
                )
            } catch (e) {
              logger.error({ err: e }, 'Failed to create offline status reply')
            }
          }
        } else {
          try {
            const idempotencyKey = `mc-${messageId}-${Date.now()}`
            const gatewayAttachments = toGatewayAttachments(attachments ?? body.attachments, {
              excludeTextLike: true,
              excludeFileNames: docxExcludedNames,
            })

            if (sessionKey) {
              const acceptedPayload = await callOpenClawGateway<any>(
                'chat.send',
                {
                  sessionKey,
                  message: gatewayMessage,
                  idempotencyKey,
                  deliver: false,
                  ...(gatewayAttachments ? { attachments: gatewayAttachments } : {}),
                },
                chatSendTimeoutMs,
              )
              const status = String(acceptedPayload?.status || '').toLowerCase()
              forwardInfo.delivered = status === 'started' || status === 'ok' || status === 'in_flight'
              forwardInfo.session = sessionKey
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
            } else {
              const invokeParams: any = {
                message: `Message from ${from}: ${gatewayMessage}`,
                idempotencyKey,
                deliver: false,
              }
              invokeParams.agentId = openclawAgentId
              if (gatewayAttachments) {
                invokeParams.attachments = gatewayAttachments
              }

              const invokeResult = await runOpenClaw(
                [
                  'gateway',
                  'call',
                  'agent',
                  '--timeout',
                  String(agentWaitCliMs),
                  '--params',
                  JSON.stringify(invokeParams),
                  '--json',
                ],
                { timeoutMs: agentWaitCliMs + 5_000 }
              )
              const acceptedPayload = parseGatewayJson(invokeResult.stdout)
              forwardInfo.delivered = true
              forwardInfo.session = openclawAgentId || undefined
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
            }
          } catch (err) {
            // OpenClaw may return accepted JSON on stdout but still emit a late stderr warning.
            // Treat accepted runs as successful delivery.
            const maybeStdout = String((err as any)?.stdout || '')
            const acceptedPayload = parseGatewayJson(maybeStdout)
            if (maybeStdout.includes('"status": "accepted"') || maybeStdout.includes('"status":"accepted"')) {
              forwardInfo.delivered = true
              forwardInfo.session = sessionKey || openclawAgentId || undefined
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
            } else {
              forwardInfo.reason = 'gateway_send_failed'
              logger.error({ err }, 'Failed to forward message via gateway')

              // For coordinator messages, emit visible status when send fails
              if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
                try {
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    'I received your message, but delivery to the live coordinator runtime failed. Please restart the coordinator/gateway session and retry.',
                    'status',
                    withPhase('error', { status: 'delivery_failed', reason: 'gateway_send_failed' })
                  )
                } catch (e) {
                  logger.error({ err: e }, 'Failed to create gateway failure status reply')
                }
              }
            }
          }

          // Coordinator mode should always show visible coordinator feedback in thread.
          if (
            typeof conversation_id === 'string' &&
            conversation_id.startsWith('coord:') &&
            forwardInfo.delivered
          ) {
            try {
              createChatReply(
                db,
                workspaceId,
                conversation_id,
                COORDINATOR_AGENT,
                from,
                'Received. I am coordinating downstream agents now.',
                'status',
                withPhase('thinking', { status: 'accepted', runId: forwardInfo.runId || null })
              )
            } catch (e) {
              logger.error({ err: e }, 'Failed to create accepted status reply')
            }

            // Best effort: wait briefly and surface completion/error feedback.
            if (forwardInfo.runId) {
              try {
                const waitResult = await runOpenClaw(
                  [
                    'gateway',
                    'call',
                    'agent.wait',
                    '--timeout',
                    String(agentWaitCliMs),
                    '--params',
                    JSON.stringify({ runId: forwardInfo.runId, timeoutMs: agentWaitInnerMs }),
                    '--json',
                  ],
                  { timeoutMs: agentWaitCliMs + 5_000 }
                )

                const waitPayload = parseGatewayJson(waitResult.stdout)
                const waitStatus = String(waitPayload?.status || '').toLowerCase()
                const toolEvents = extractToolEvents(waitPayload)

                if (toolEvents.length > 0) {
                  for (const evt of toolEvents) {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      evt.name,
                      'tool_call',
                      withPhase('thinking', {
                        event: 'tool_call',
                        toolName: evt.name,
                        input: evt.input || null,
                        output: evt.output || null,
                        status: evt.status || null,
                        runId: forwardInfo.runId || null,
                      })
                    )
                  }
                }

                if (waitStatus === 'error') {
                  const reason =
                    typeof waitPayload?.error === 'string'
                      ? waitPayload.error
                      : 'Unknown runtime error'
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    `I received your message, but execution failed: ${reason}`,
                    'status',
                    withPhase('error', { status: 'error', runId: forwardInfo.runId })
                  )
                } else if (waitStatus === 'timeout') {
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    'I received your message and I am still processing it. I will post results as soon as execution completes.',
                    'status',
                    withPhase('thinking', { status: 'processing', runId: forwardInfo.runId })
                  )
                } else {
                  const replyText = extractReplyText(waitPayload)
                  if (replyText) {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      replyText,
                      'text',
                      withPhase('final', { status: waitStatus || 'completed', runId: forwardInfo.runId })
                    )
                  } else {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      'Execution accepted and completed. No textual response payload was returned by the runtime.',
                      'status',
                      withPhase('final', { status: waitStatus || 'completed', runId: forwardInfo.runId })
                    )
                  }
                }
              } catch (waitErr) {
                const maybeWaitStdout = String((waitErr as any)?.stdout || '')
                const maybeWaitStderr = String((waitErr as any)?.stderr || '')
                const waitPayload = parseGatewayJson(maybeWaitStdout)
                const reason =
                  typeof waitPayload?.error === 'string'
                    ? waitPayload.error
                    : (maybeWaitStderr || maybeWaitStdout || 'Unable to read completion status from coordinator runtime.').trim()

                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  COORDINATOR_AGENT,
                  from,
                  `I received your message, but I could not retrieve completion output yet: ${reason}`,
                  'status',
                  withPhase('error', { status: 'unknown', runId: forwardInfo.runId })
                )
              }
            }
          }
        }
      }
    }

    // For standard conversations, emit immediate visible status feedback so
    // the user sees "assistant is responding" even before full runtime output arrives.
    if (
      body.forward &&
      to &&
      typeof conversation_id === 'string' &&
      !conversation_id.startsWith('coord:')
    ) {
      try {
        if (forwardInfo?.delivered) {
          createChatReply(
            db,
            workspaceId,
            conversation_id,
            String(to),
            from,
            '已收到，正在处理你的消息...',
            'status',
            withPhase('thinking', {
              status: 'accepted',
              runId: forwardInfo.runId || null,
              sessionKey: forwardInfo.session || undefined,
            })
          )
        } else {
          const reason = forwardInfo?.reason || 'unknown'
          createChatReply(
            db,
            workspaceId,
            conversation_id,
            String(to),
            from,
            `消息已接收，但暂未投递成功：${reason}`,
            'status',
            withPhase('error', { status: 'delivery_failed', reason })
          )
        }
      } catch (statusErr) {
        logger.error({ err: statusErr }, 'Failed to create standard chat status reply')
      }

      // Best effort: for normal chats, also wait briefly for completion so the
      // user can receive a real follow-up message instead of a stuck "accepted" state.
      if (forwardInfo?.delivered && forwardInfo.runId) {
        try {
          const waitResult = await runOpenClaw(
            [
              'gateway',
              'call',
              'agent.wait',
              '--timeout',
              String(agentWaitCliMs),
              '--params',
              JSON.stringify({ runId: forwardInfo.runId, timeoutMs: agentWaitInnerMs }),
              '--json',
            ],
            { timeoutMs: agentWaitCliMs + 5_000 }
          )

          const waitPayload = parseGatewayJson(waitResult.stdout)
          const waitStatus = String(waitPayload?.status || '').toLowerCase()
          const toolEvents = extractToolEvents(waitPayload)
          const replyText = extractReplyText(waitPayload)

          if (toolEvents.length > 0) {
            for (const evt of toolEvents) {
              createChatReply(
                db,
                workspaceId,
                conversation_id,
                String(to),
                from,
                evt.name,
                'tool_call',
                withPhase('thinking', {
                  event: 'tool_call',
                  toolName: evt.name,
                  input: evt.input || null,
                  output: evt.output || null,
                  status: evt.status || null,
                  runId: forwardInfo.runId || null,
                })
              )
            }
          }

          if (waitStatus === 'error') {
            const reason =
              typeof waitPayload?.error === 'string'
                ? waitPayload.error
                : 'Unknown runtime error'
            createChatReply(
              db,
              workspaceId,
              conversation_id,
              String(to),
              from,
              `执行失败：${reason}`,
              'status',
              withPhase('error', { status: 'error', runId: forwardInfo.runId })
            )
          } else if (waitStatus === 'timeout') {
            createChatReply(
              db,
              workspaceId,
              conversation_id,
              String(to),
              from,
              '还在处理中，请稍候...',
              'status',
              withPhase('thinking', {
                status: 'processing',
                runId: forwardInfo.runId,
                sessionKey: forwardInfo.session || undefined,
              })
            )
          } else if (replyText) {
            createChatReply(
              db,
              workspaceId,
              conversation_id,
              String(to),
              from,
              replyText,
              'text',
              withPhase('final', { status: waitStatus || 'completed', runId: forwardInfo.runId })
            )
          } else {
            const historyReply = await readLatestAssistantReplyFromHistory(forwardInfo.session || null)
            if (historyReply) {
              createChatReply(
                db,
                workspaceId,
                conversation_id,
                String(to),
                from,
                historyReply,
                'text',
                withPhase('final', { status: waitStatus || 'completed', runId: forwardInfo.runId, source: 'chat.history' })
              )
            } else {
              createChatReply(
                db,
                workspaceId,
                conversation_id,
                String(to),
                from,
                '已完成处理，但运行时没有返回可展示的文本内容。',
                'status',
                withPhase('final', { status: waitStatus || 'completed', runId: forwardInfo.runId })
              )
            }
          }
        } catch (waitErr) {
          const maybeWaitStdout = String((waitErr as any)?.stdout || '')
          const maybeWaitStderr = String((waitErr as any)?.stderr || '')
          const waitPayload = parseGatewayJson(maybeWaitStdout)
          const reason =
            typeof waitPayload?.error === 'string'
              ? waitPayload.error
              : (maybeWaitStderr || maybeWaitStdout || '无法获取运行完成状态').trim()
          createChatReply(
            db,
            workspaceId,
            conversation_id,
            String(to),
            from,
            `消息已投递，但暂时无法读取结果：${reason}`,
            'status',
            withPhase('error', { status: 'unknown', runId: forwardInfo.runId })
          )
        }
      }
    }

    if (forwardInfo) {
      forwardInfo.completed = true
    }

    /** 首条消息的 session.label 由客户端在发消息前 PATCH /api/chat/sessions 与侧栏标题同步写入，此处不再重复 sessions.patch */

    const created = db.prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?').get(messageId, workspaceId) as Message
    const parsedMessage = {
      ...created,
      metadata: {
        ...(safeParseMetadata(created.metadata) || {}),
        forwardInfo: forwardInfo || undefined,
      },
      attachments,
    }

    // Broadcast to SSE clients
    eventBus.broadcast('chat.message', parsedMessage)

    return NextResponse.json(
      {
        message: parsedMessage,
        forward: forwardInfo,
      },
      { status: 201 },
    )
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

/** 大体积 base64 附件需在 Node 运行时处理；避免 Edge 默认限制 */
export const runtime = 'nodejs'
