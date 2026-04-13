import type { ChatMessage, CurrentUser } from '@/store'
import { isGatewaySyntheticUserContext, isUserChatMessage } from '../components/chat/chat-helpers'

/**
 * 会话内是否已有「可视为已落地的助手终稿」——用于全量拉取/轮询时决定是否过滤库里 accepted+thinking 占位。
 *
 * 不可把 `shouldClearAwaitingReplyForMessage` 与 `awaitingRunId: null` 混用：`runMatches` 在 awaitingRun 为空时恒为真，
 * 会把缺少 phase/role 的任意 text 误判为终稿，从而滤掉唯一的 thinking 状态行，界面像「什么都没渲染」。
 */
export function hasPersistedAssistantFinalForConversation(
  messages: ChatMessage[],
  conversationId: string,
  currentUser: CurrentUser | null,
): boolean {
  for (const m of messages) {
    if (m.conversation_id !== conversationId) continue
    if (isUserChatMessage(m, currentUser)) continue
    if (isGatewaySyntheticUserContext(m)) continue

    const meta = (m.metadata || {}) as Record<string, unknown>
    const phase = String(meta.phase || '').toLowerCase()
    const role = String(meta.role || '').toLowerCase()

    if (m.message_type === 'text') {
      if (phase === 'final' || phase === 'error' || role === 'assistant') {
        if (String(m.content || '').trim().length > 0) return true
      }
    }
    if (m.message_type === 'status' && (phase === 'final' || phase === 'error')) {
      return true
    }
  }
  return false
}

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
    if (role === 'assistant') {
      return true
    }
    /**
     * DB 落库的终稿常已带 phase=final，但 status 仍为 processing；若在此处因 processing 提前 return false，
     * 轮询永远清不掉 awaiting，只能等 SSE 用「更干净」的 metadata 覆盖。
     */
    if (phase === 'final' || phase === 'error') {
      return true
    }
    /**
     * GET/DB 增量拉取的消息常缺少 metadata.role，但可能带与 forward.runId 不一致的 runId。
     * 若先走下方 runMatches，会在此处被拦截，轮询 clearAwaitingIfNeeded 永远为 false，只能等 SSE 才清 awaiting。
     * 对「已排除真人/网关注入」的 text：非 user、非 thinking、且非流式状态时视为可结束等待。
     */
    if (role !== 'user' && phase !== 'thinking') {
      if (status === 'accepted' || status === 'processing') {
        return false
      }
      return true
    }
  }

  const runMatches = !awaitingRun || !msgRunId || msgRunId === awaitingRun
  if (!runMatches) return false

  if (message.message_type === 'tool_call' || metadata.event === 'tool_call') return false

  if (phase === 'final' || phase === 'error') return true

  if (
    message.message_type === 'status' &&
    (phase === 'thinking' || !phase) &&
    (status === 'accepted' || status === 'processing')
  ) {
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

  return false
}
