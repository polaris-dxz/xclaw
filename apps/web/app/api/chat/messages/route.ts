import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, Message } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { scanForInjection } from '@/lib/injection-guard'
import {
  COORDINATOR_AGENT,
  DEFAULT_AGENT_WAIT_CLI_EXTRA_MS,
  DEFAULT_AGENT_WAIT_INNER_MS,
  GATEWAY_ATTACHMENT_ONLY_HINT,
} from '@/lib/chat-messages/constants'
import type { ForwardInfo } from '@/lib/chat-messages/forward-info'
import {
  resolveChatPostProcessKind,
  logChatForwardRouting,
} from '@/lib/chat-messages/forward-kind'
import { safeParseMetadata } from '@/lib/chat-messages/chat-reply-writer'
import {
  openclawMessageLine,
  parseOpenclawEventJson,
  stringifyOpenclawEventLine,
} from '@/lib/chat-messages/openclaw-event-shape'
import {
  normalizeMessageAttachments,
  appendInlinedTextFromAttachments,
  appendDocxTextFromAttachments,
} from '@/lib/chat-messages/message-attachments'
import { executeGatewayChatSend } from '@/lib/chat-messages/gateway-delivery'
import { runCoordinatorThreadAfterGatewaySend } from '@/lib/chat-messages/coordinator-thread-strategy'
import { runStandardChatAgentWaitInline } from '@/lib/chat-messages/standard-forward-strategy'
import { replaceGatewayConversationFromDiskJsonl } from '@/lib/chat-messages/gateway-jsonl-sqlite-sync'
import { stripUntrustedSenderMetadataEnvelope } from '@/lib/chat-messages/untrusted-sender-envelope'
import { formatOpenclawGatewayInfraForDisplay } from '@/lib/chat-messages/openclaw-infra-tool-json'

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
      const openclaw_event = parseOpenclawEventJson(msg.openclaw_event_json)
      const { openclaw_event_json: _raw, ...rest } = msg
      const metaRole = String((metadata as Record<string, unknown>).role || '').toLowerCase()
      const fromLower = String(msg.from_agent || '').toLowerCase()
      const senderType = String((metadata as Record<string, unknown>).senderType || '').toLowerCase()
      const isUserLikeRow =
        msg.message_type === 'text' &&
        (metaRole === 'user' || fromLower === 'user' || senderType === 'user' || fromLower === 'you')
      const infraSummaryLine =
        msg.message_type === 'text' ? formatOpenclawGatewayInfraForDisplay(msg.content) : null
      const content =
        infraSummaryLine ??
        (msg.message_type === 'text' && isUserLikeRow
          ? stripUntrustedSenderMetadataEnvelope(msg.content)
          : msg.content)
      return {
        ...rest,
        content,
        metadata,
        attachments,
        ...(openclaw_event ? { openclaw_event } : {}),
      }
    })

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
    const storedContent =
      userText ||
      (attachments
        ? `[附件] ${attachments.map((a) => a.name).join('，')}`
        : '')
    let gatewayMessage = userText || (attachments ? GATEWAY_ATTACHMENT_ONLY_HINT : '')
    gatewayMessage = appendInlinedTextFromAttachments(gatewayMessage, attachments)
    const docxInline = await appendDocxTextFromAttachments(gatewayMessage, attachments)
    gatewayMessage = docxInline.message
    const docxExcludedNames = docxInline.excludedFileNames

    const agentWaitInnerMs = DEFAULT_AGENT_WAIT_INNER_MS
    const agentWaitCliMs = agentWaitInnerMs + DEFAULT_AGENT_WAIT_CLI_EXTRA_MS
    const chatSendTimeoutMs = attachments?.length ? 120_000 : 12_000
    const metadata = {
      ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
      ...(selectedModel ? { selectedModel } : {}),
      ...(attachments ? { attachments } : {}),
      senderType: 'user',
    }

    if (!userText && !attachments) {
      return NextResponse.json({ error: '需要正文或至少一个附件' }, { status: 400 })
    }

    if (body.forward && to && userText) {
      const injectionReport = scanForInjection(userText, { context: 'prompt' })
      if (!injectionReport.safe) {
        const criticals = injectionReport.matches.filter((m) => m.severity === 'critical')
        if (criticals.length > 0) {
          logger.warn({ to, rules: criticals.map((m) => m.rule) }, 'Blocked chat message: injection detected')
          return NextResponse.json(
            {
              error: 'Message blocked: potentially unsafe content detected',
              injection: criticals.map((m) => ({ rule: m.rule, description: m.description })),
            },
            { status: 422 },
          )
        }
      }
    }

    const userOpenclawJson = stringifyOpenclawEventLine(
      openclawMessageLine('user', storedContent, new Date().toISOString()),
    )

    const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id, openclaw_event_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      conversation_id,
      from,
      to,
      storedContent,
      message_type,
      Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
      workspaceId,
      userOpenclawJson,
    )

    const messageId = result.lastInsertRowid as number

    let forwardInfo: ForwardInfo | null = null

    const postKind = resolveChatPostProcessKind(String(conversation_id))

    db_helpers.logActivity(
      'chat_message',
      'message',
      messageId,
      from,
      `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`,
      { conversation_id, to, message_type, postKind },
      workspaceId,
    )

    if (to) {
      db_helpers.createNotification(
        to,
        'chat_message',
        `Message from ${from}`,
        storedContent.substring(0, 200) + (storedContent.length > 200 ? '...' : ''),
        'message',
        messageId,
        workspaceId,
      )

      if (body.forward) {
        const sendResult = await executeGatewayChatSend({
          db,
          workspaceId,
          conversation_id: String(conversation_id),
          to,
          from,
          messageId,
          gatewayMessage,
          attachments,
          body,
          docxExcludedNames,
          chatSendTimeoutMs,
          agentWaitCliMs,
        })
        forwardInfo = sendResult.forwardInfo

        logChatForwardRouting({
          postKind,
          conversation_id: String(conversation_id),
          to,
          chatSendStatus: sendResult.rawChatSendStatus,
          forwardDelivered: Boolean(forwardInfo.delivered),
          forwardRunId: forwardInfo.runId ?? null,
          sessionKey: forwardInfo.session ?? null,
        })

        if (postKind === 'coordinator_thread') {
          await runCoordinatorThreadAfterGatewaySend({
            db,
            workspaceId,
            conversation_id: String(conversation_id),
            from,
            forwardInfo,
            agentWaitCliMs,
            agentWaitInnerMs,
          })
        }
      }
    }

    let jsonlResync = false
    if (body.forward && to && postKind === 'standard_forwarded' && forwardInfo) {
      await runStandardChatAgentWaitInline({
        db,
        workspaceId,
        conversation_id: String(conversation_id),
        to,
        from,
        forwardInfo,
        agentWaitCliMs,
        agentWaitInnerMs,
      })
      const sk = forwardInfo.session
      if (
        forwardInfo.delivered &&
        typeof conversation_id === 'string' &&
        conversation_id.startsWith('gw:') &&
        typeof sk === 'string' &&
        sk.trim()
      ) {
        const syncResult = await replaceGatewayConversationFromDiskJsonl(
          db,
          workspaceId,
          String(conversation_id),
          sk.trim(),
        )
        jsonlResync = Boolean(syncResult.ok)
      }
    }

    if (forwardInfo) {
      forwardInfo.completed = true
    }

    let created =
      (db
        .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
        .get(messageId, workspaceId) as Message | undefined) ?? null

    if (jsonlResync) {
      const syncedUser =
        (db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id = ? AND workspace_id = ? AND from_agent = ? AND content = ? ORDER BY id DESC LIMIT 1`,
          )
          .get(String(conversation_id), workspaceId, from, storedContent) as Message | undefined) ?? null
      if (syncedUser) created = syncedUser
    }

    if (!created) {
      created =
        (db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id = ? AND workspace_id = ? ORDER BY id DESC LIMIT 1`,
          )
          .get(String(conversation_id), workspaceId) as Message | undefined) ?? null
    }

    if (!created) {
      logger.error({ conversation_id, messageId, jsonlResync }, 'POST /api/chat/messages: failed to reload message row')
      return NextResponse.json({ error: 'Failed to reload message after send' }, { status: 500 })
    }
    const openclaw_event = parseOpenclawEventJson(created.openclaw_event_json)
    const { openclaw_event_json: _rawCreated, ...createdRest } = created
    const parsedMessage = {
      ...createdRest,
      metadata: {
        ...(safeParseMetadata(created.metadata) || {}),
        forwardInfo: forwardInfo || undefined,
      },
      attachments,
      ...(openclaw_event ? { openclaw_event } : {}),
    }

    eventBus.broadcast('chat.message', parsedMessage)

    return NextResponse.json(
      {
        message: parsedMessage,
        forward: forwardInfo,
        jsonl_resync: jsonlResync,
      },
      { status: 201 },
    )
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

export const runtime = 'nodejs'
