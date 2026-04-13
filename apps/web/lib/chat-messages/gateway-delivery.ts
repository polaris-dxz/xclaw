import { runOpenClaw } from '@/lib/command'
import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { resolveCoordinatorDeliveryTarget } from '@/lib/coordinator-routing'
import { getAllGatewaySessions } from '@/lib/sessions'
import { logger } from '@/lib/logger'
import { COORDINATOR_AGENT } from '@/lib/chat-messages/constants'
import type { ForwardInfo } from '@/lib/chat-messages/forward-info'
import { isChatSendDeliveredStatus } from '@/lib/chat-messages/forward-kind'
import { parseGatewayJson, gatewaySendStdoutIndicatesDelivered } from '@/lib/chat-messages/gateway-json'
import { toGatewayAttachments } from '@/lib/chat-messages/gateway-attachments'
import { createChatReply, withPhase, type ChatSqliteDb } from '@/lib/chat-messages/chat-reply-writer'
import { openclawMessageLine, stringifyOpenclawEventLine } from '@/lib/chat-messages/openclaw-event-shape'

export type NormalizedAttachments = Array<{ name: string; type: string; size: number; dataUrl: string }>

export type GatewayForwardBody = {
  forward?: boolean
  sessionKey?: string
  attachments?: unknown
}

export type GatewayForwardParams = {
  db: ChatSqliteDb
  workspaceId: number
  conversation_id: string
  to: string
  from: string
  messageId: number
  gatewayMessage: string
  attachments: NormalizedAttachments | undefined
  body: GatewayForwardBody
  docxExcludedNames: Set<string>
  chatSendTimeoutMs: number
  agentWaitCliMs: number
}

export type GatewayForwardResult = {
  forwardInfo: ForwardInfo
  /** 仅 sessionKey + chat.send 成功路径有值，供路由日志使用 */
  rawChatSendStatus?: string
}

/**
 * 解析 session、调用 chat.send / agent invoke，更新 forwardInfo（不含 agent.wait）。
 */
export async function executeGatewayChatSend(params: GatewayForwardParams): Promise<GatewayForwardResult> {
  const {
    db,
    workspaceId,
    conversation_id,
    to,
    from,
    messageId,
    gatewayMessage,
    attachments,
    body,
    docxExcludedNames,
    chatSendTimeoutMs,
    agentWaitCliMs,
  } = params

  const forwardInfo: ForwardInfo = { attempted: true, delivered: false }
  let rawChatSendStatus: string | undefined

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

  let sessionKey: string | null = coordinatorResolution.sessionKey

  if (!sessionKey) {
    const match = sessions.find(
      (s) =>
        s.agent.toLowerCase() === String(to).toLowerCase() ||
        s.agent.toLowerCase() === coordinatorResolution.deliveryName.toLowerCase() ||
        s.agent.toLowerCase() === String(coordinatorResolution.openclawAgentId || '').toLowerCase(),
    )
    sessionKey = match?.key || match?.sessionId || null
  }

  const openclawAgentId: string | null = coordinatorResolution.openclawAgentId

  if (!sessionKey && !openclawAgentId) {
    forwardInfo.reason = 'no_active_session'

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
          withPhase('error', { status: 'offline', reason: 'no_active_session' }),
          stringifyOpenclawEventLine(
            openclawMessageLine(
              'assistant',
              'I received your message, but my live coordinator session is offline right now. Start/restore the coordinator session and retry.',
              new Date().toISOString(),
            ),
          ),
        )
      } catch (e) {
        logger.error({ err: e }, 'Failed to create offline status reply')
      }
    }
    return { forwardInfo }
  }

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
      rawChatSendStatus = status
      forwardInfo.delivered = isChatSendDeliveredStatus(status)
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
        { timeoutMs: agentWaitCliMs + 5_000 },
      )
      const acceptedPayload = parseGatewayJson(invokeResult.stdout)
      forwardInfo.delivered = true
      forwardInfo.session = openclawAgentId || undefined
      if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
        forwardInfo.runId = acceptedPayload.runId
      }
    }
  } catch (err) {
    const maybeStdout = String((err as any)?.stdout || '')
    const acceptedPayload = parseGatewayJson(maybeStdout)
    if (gatewaySendStdoutIndicatesDelivered(maybeStdout, acceptedPayload)) {
      forwardInfo.delivered = true
      forwardInfo.session = sessionKey || openclawAgentId || undefined
      if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
        forwardInfo.runId = acceptedPayload.runId
      }
      if (acceptedPayload && typeof acceptedPayload === 'object') {
        rawChatSendStatus = String((acceptedPayload as Record<string, unknown>).status || '').toLowerCase()
      }
    } else {
      forwardInfo.reason = 'gateway_send_failed'
      logger.error({ err }, 'Failed to forward message via gateway')

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
            withPhase('error', { status: 'delivery_failed', reason: 'gateway_send_failed' }),
            stringifyOpenclawEventLine(
              openclawMessageLine(
                'assistant',
                'I received your message, but delivery to the live coordinator runtime failed. Please restart the coordinator/gateway session and retry.',
                new Date().toISOString(),
              ),
            ),
          )
        } catch (e) {
          logger.error({ err: e }, 'Failed to create gateway failure status reply')
        }
      }
    }
  }

  return { forwardInfo, rawChatSendStatus }
}
