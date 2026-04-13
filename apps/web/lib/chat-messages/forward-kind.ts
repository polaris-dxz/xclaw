import { logger } from '@/lib/logger'

/**
 * 投递后「等结果 / 写占位」的策略，只由 conversation_id 前缀决定（与收件人 to 解耦）。
 * - coordinator_thread：coord: 会话，POST 内同步 agent.wait
 * - standard_forwarded：含 gw: 在内的其它转发会话，占位 + Next after() 异步 agent.wait
 */
export type ChatPostProcessKind = 'coordinator_thread' | 'standard_forwarded'

export function resolveChatPostProcessKind(conversation_id: string): ChatPostProcessKind {
  return conversation_id.startsWith('coord:') ? 'coordinator_thread' : 'standard_forwarded'
}

/** chat.send 返回的 status：与 gatewaySendStdoutIndicatesDelivered 对齐 */
export function isChatSendDeliveredStatus(status: string): boolean {
  const s = String(status || '').toLowerCase()
  return s === 'started' || s === 'ok' || s === 'in_flight' || s === 'accepted'
}

/** 调试：单点打日志，便于对照网关与本地 forwardInfo */
export function logChatForwardRouting(params: {
  postKind: ChatPostProcessKind
  conversation_id: string
  to: string | null
  chatSendStatus?: string
  forwardDelivered: boolean
  forwardRunId?: string | null
  sessionKey?: string | null
}): void {
  logger.info(
    {
      chatForwardRouting: true,
      postKind: params.postKind,
      conversation_id: params.conversation_id,
      to: params.to,
      chatSendStatus: params.chatSendStatus,
      forwardDelivered: params.forwardDelivered,
      forwardRunId: params.forwardRunId ?? null,
      sessionKey: params.sessionKey ?? null,
    },
    'chat POST gateway routing',
  )
}
