import type { ChatMessage, CurrentUser } from '@/store'
import { isGatewaySyntheticUserContext, isUserChatMessage } from '../components/chat/chat-helpers'

/**
 * 判断一条消息是否应结束「等待助手回复」。
 * Gateway / SSE 有时不带 phase、或同一 id 重复推送，需与 chat-panel POST 预判共用一套规则。
 */
export function shouldClearAwaitingReplyForMessage(
  state: {
    isAwaitingReply: boolean
    awaitingConversationId: string | null
    awaitingRunId: string | null
    currentUser: CurrentUser | null
  },
  message: ChatMessage,
): boolean {
  if (!state.isAwaitingReply) return false
  if (!state.awaitingConversationId || state.awaitingConversationId !== message.conversation_id) return false

  const metadata = (message.metadata || {}) as Record<string, unknown>
  const status = typeof metadata.status === 'string' ? metadata.status.toLowerCase() : ''
  const phase = String(metadata.phase || '').toLowerCase()
  const msgRunId = typeof metadata.runId === 'string' ? metadata.runId : ''
  const awaitingRun = state.awaitingRunId

  /** 工具 JSON / 读入文件等网关注入内容，不能当作「助手已回复」结束等待 */
  if (isGatewaySyntheticUserContext(message)) return false

  /**
   * 部分落库/同步的助手终稿误带 metadata.role=user。isUserChatMessage 会因 role=user 直接判真人，
   * 导致本函数在下方「终稿」分支之前就 return false，isAwaitingReply 永远无法清除。
   * 终稿 phase=final|error 且明显非本机发送（from_agent !== you）时，仍视为可结束等待。
   */
  if (
    message.message_type === 'text' &&
    (phase === 'final' || phase === 'error') &&
    String(metadata.role || '').toLowerCase() === 'user' &&
    String(message.from_agent || '').toLowerCase() !== 'you'
  ) {
    return true
  }

  /** 与聊天列表共用真人判定（含 gateway from_agent=user 的真实提问） */
  if (isUserChatMessage(message, state.currentUser)) return false

  /**
   * 终稿 text + role=assistant 常不带 runId，或与 POST forward.runId 不一致（历史同步 / chat.history），
   * 若仍要求 runId 一致会永远不结束等待。
   */
  if (message.message_type === 'text') {
    const role = String(metadata.role || '').toLowerCase()
    console.log('[shouldClear] text message, role:', role, 'phase:', phase, 'status:', status)
    if (role === 'assistant') {
      console.log('[shouldClear] Returning TRUE: role=assistant')
      return true
    }
    /**
     * DB 落库的终稿常已带 phase=final，但 status 仍为 processing；若在此处因 processing 提前 return false，
     * 轮询永远清不掉 awaiting，只能等 SSE 用「更干净」的 metadata 覆盖。
     */
    if (phase === 'final' || phase === 'error') {
      console.log('[shouldClear] Returning TRUE: phase final/error')
      return true
    }
    /**
     * GET/DB 增量拉取的消息常缺少 metadata.role，但可能带与 forward.runId 不一致的 runId。
     * 若先走下方 runMatches，会在此处被拦截，轮询 clearAwaitingIfNeeded 永远为 false，只能等 SSE 才清 awaiting。
     * 对「已排除真人/网关注入」的 text：非 user、非 thinking、且非流式状态时视为可结束等待。
     */
    if (role !== 'user' && phase !== 'thinking') {
      console.log('[shouldClear] text: role!=user && phase!=thinking')
      if (status === 'accepted' || status === 'processing') {
        console.log('[shouldClear] Returning FALSE: status accepted/processing')
        return false
      }
      console.log('[shouldClear] Returning TRUE: not accepted/processing')
      return true
    }
  }

  const runMatches = !awaitingRun || !msgRunId || msgRunId === awaitingRun
  console.log('[shouldClear] runMatches:', runMatches, { awaitingRun, msgRunId })
  if (!runMatches) return false

  if (message.message_type === 'tool_call' || metadata.event === 'tool_call') return false

  if (phase === 'final' || phase === 'error') return true

  if (
    message.message_type === 'status' &&
    (phase === 'thinking' || !phase) &&
    (status === 'accepted' || status === 'processing')
  ) {
    console.log('[shouldClear] status message with accepted/processing, returning FALSE')
    return false
  }

  if (message.message_type === 'text') {
    const role = String(metadata.role || '').toLowerCase()
    if (phase === 'thinking') return false
    /**
     * Gateway 历史里最终回复常为 text + role=assistant，且可能仍带 status=processing；
     * 旧逻辑会把 processing 当成「仍在流式」而永远不结束等待。
     */
    if (['completed', 'done', 'success', 'complete', 'idle', 'finished'].includes(status)) return true
    if (status === 'accepted' || status === 'processing') return false
    return true
  }

  if (message.message_type === 'status') {
    if (phase === 'final' || phase === 'error') return true
    if (['error', 'delivery_failed', 'unknown', 'offline'].includes(status)) return true
  }

  console.log('[shouldClear] Default returning FALSE for:', { message_type: message.message_type, phase, status, role: metadata.role })
  return false
}
