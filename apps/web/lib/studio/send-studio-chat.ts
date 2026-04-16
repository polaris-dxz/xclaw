/**
 * Studio 侧栏发消息：与主界面 ChatPanel 使用同一会话与 /api/chat/messages 链路。
 */
import {
  useXClawStore,
  type ChatMessage,
  type Conversation,
  type CurrentUser,
} from '@/store'
import {
  isGatewaySyntheticUserContext,
  isUserChatMessage,
  resolveOutgoingRecipient,
  stripAssistantXmlFinalWrapper,
  stripInlinedAttachmentPreviewFromUserContent,
  stripOpenClawAssistantFooter,
} from '@/components/chat/chat-helpers'
import { hasPersistedAssistantFinalForConversation } from '@/lib/awaiting-reply'
import { isPendingConversation } from '@/lib/pending-conversation'
import { setConversationTitleOverride } from '@/lib/conversation-title-overrides'
import { buildFirstMessageSessionLabel } from '@/lib/session-label'
import { fetchConversationMessages, mergeConversationIntoMessages } from '@/lib/chat-sync'
import { STUDIO_COMPOSER_AGENT_SESSION_KEY } from '@/lib/studio/composer-session'

const LOCAL_SELECTED_MODEL_KEY = 'mc-selected-model'

function readComposerSelectedAgent(): string {
  if (typeof sessionStorage === 'undefined') return 'all'
  try {
    const v = sessionStorage.getItem(STUDIO_COMPOSER_AGENT_SESSION_KEY)
    return v && v.trim() ? v.trim() : 'all'
  } catch {
    return 'all'
  }
}

function readComposerSelectedModel(): string | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const v = localStorage.getItem(LOCAL_SELECTED_MODEL_KEY)
    return v && v.trim() ? v.trim().slice(0, 120) : undefined
  } catch {
    return undefined
  }
}

function fallbackCoordinator(): string {
  return process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'main'
}

function extractLatestAssistantDisplay(
  messages: ChatMessage[],
  conversationId: string,
  userMessageCreatedAt: number,
  currentUser: CurrentUser | null,
): string | null {
  const after = messages.filter(
    (m) => m.conversation_id === conversationId && m.created_at > userMessageCreatedAt,
  )
  const sorted = [...after].sort((a, b) => a.created_at - b.created_at)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const m = sorted[i]
    if (m.message_type !== 'text') continue
    if (isUserChatMessage(m, currentUser)) continue
    if (isGatewaySyntheticUserContext(m)) continue
    const raw = stripOpenClawAssistantFooter(
      stripAssistantXmlFinalWrapper(
        stripInlinedAttachmentPreviewFromUserContent(String(m.content || '')).trim(),
      ),
    ).trim()
    if (raw.length > 0) return raw
  }
  return null
}

/**
 * 轮询直到出现「可视为终稿」的助手回复（与 ChatPanel / awaiting-reply 对齐）或超时。
 * Studio 父窗口在首包 postMessage 后可在后台继续调用本函数，避免 iframe 内 Promise 长时间挂起超时。
 */
export async function pollStudioAssistantReply(
  conversationId: string,
  userMessageCreatedAt: number,
  maxMs = 90_000,
): Promise<string | null> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const currentUser = useXClawStore.getState().currentUser
    const msgs = await fetchConversationMessages(conversationId, {
      since: Math.max(0, userMessageCreatedAt - 5),
      limit: 120,
    })
    const convSlice = msgs.filter(
      (m) => m.conversation_id === conversationId && m.created_at >= userMessageCreatedAt - 2,
    )
    if (hasPersistedAssistantFinalForConversation(convSlice, conversationId, currentUser)) {
      const text = extractLatestAssistantDisplay(msgs, conversationId, userMessageCreatedAt, currentUser)
      if (text) return text
    }
    const elapsed = Date.now() - start
    await new Promise((r) => setTimeout(r, elapsed < 45_000 ? 700 : 2000))
  }
  const currentUser = useXClawStore.getState().currentUser
  const tail = await fetchConversationMessages(conversationId, { limit: 200 })
  return extractLatestAssistantDisplay(tail, conversationId, userMessageCreatedAt, currentUser)
}

export type SendStudioChatOptions = {
  /**
   * false：POST 成功后立即返回（reply 多为 null），由调用方自行轮询 `pollStudioAssistantReply` 再更新 iframe，
   * 避免 Studio 内嵌页「等待主应用响应」与 120s Promise 超时。
   * true：在函数内阻塞轮询至终稿或超时（仅适合非 iframe 场景）。
   */
  awaitAssistantReply?: boolean
}

export type SendStudioChatResult =
  | { ok: true; reply: string | null; conversationId: string; userMessageCreatedAt: number }
  | { ok: false; error: string }

/**
 * 使用当前侧栏 activeConversation 与主输入区同款收件人解析（sessionStorage + 会话 id）。
 */
export async function sendStudioChatMessage(
  trimmedText: string,
  options?: SendStudioChatOptions,
): Promise<SendStudioChatResult> {
  const text = trimmedText.trim()
  if (!text) {
    return { ok: false, error: '消息不能为空' }
  }

  const {
    activeConversation,
    setConversations,
    setActiveConversation,
    updateConversation,
  } = useXClawStore.getState()

  if (!activeConversation) {
    return { ok: false, error: '请先在左侧选择或创建一个会话' }
  }

  let convId = activeConversation
  const selectedAgent = readComposerSelectedAgent()
  const selectedModel = readComposerSelectedModel()

  if (isPendingConversation(activeConversation)) {
    try {
      const sessionRes = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const sessionData = (await sessionRes.json().catch(() => ({}))) as {
        conversation_id?: string
        label?: string
        error?: string
      }
      const gw =
        sessionRes.ok &&
        typeof sessionData.conversation_id === 'string' &&
        sessionData.conversation_id.startsWith('gw:')
          ? sessionData.conversation_id
          : null
      if (!gw) {
        return {
          ok: false,
          error:
            typeof sessionData.error === 'string' && sessionData.error
              ? sessionData.error
              : sessionRes.status === 401 || sessionRes.status === 403
                ? '请重新登录后再试'
                : '无法创建网关会话',
        }
      }
      const label =
        typeof sessionData.label === 'string' && sessionData.label.trim()
          ? sessionData.label.trim()
          : '新对话'
      setConversationTitleOverride(gw, label)
      const now = Math.floor(Date.now() / 1000)
      const newConv: Conversation = {
        id: gw,
        name: label,
        customTitle: label,
        participants: [],
        unreadCount: 0,
        updatedAt: now,
      }
      const pendingId = activeConversation
      const prev = useXClawStore.getState().conversations
      setConversations([newConv, ...prev.filter((c) => c.id !== pendingId && c.id !== gw)])
      setActiveConversation(gw)
      convId = gw
    } catch {
      return { ok: false, error: '创建会话失败' }
    }
  }

  const { to, content: cleanContent } = resolveOutgoingRecipient({
    content: text,
    activeConversation: convId,
    selectedAgent,
    fallbackAgent: fallbackCoordinator(),
  })

  const priorForConv = useXClawStore.getState().chatMessages.filter((m) => m.conversation_id === convId).length
  if (priorForConv === 0) {
    const sk = convId.startsWith('gw:') ? convId.slice(3) : ''
    const optimisticTitle = buildFirstMessageSessionLabel(cleanContent, sk, undefined)
    const nowSec = Math.floor(Date.now() / 1000)
    updateConversation(convId, {
      name: optimisticTitle,
      customTitle: optimisticTitle,
      updatedAt: nowSec,
    })
    if (convId.startsWith('gw:')) {
      try {
        const patchRes = await fetch('/api/chat/sessions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: convId, label: optimisticTitle }),
        })
        const patchData = (await patchRes.json().catch(() => ({}))) as { label?: string }
        if (patchRes.ok && typeof patchData.label === 'string' && patchData.label.trim()) {
          const finalLabel = patchData.label.trim()
          if (finalLabel !== optimisticTitle) {
            updateConversation(convId, {
              name: finalLabel,
              customTitle: finalLabel,
              updatedAt: Math.floor(Date.now() / 1000),
            })
          }
        }
      } catch {
        // 标题同步失败不阻塞发送
      }
    }
  }

  const response = await fetch('/api/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      conversation_id: convId,
      to,
      content: cleanContent,
      model: selectedModel || undefined,
      message_type: 'text',
      attachments: undefined,
      forward: true,
    }),
  })

  const data = (await response.json().catch(() => ({}))) as {
    message?: ChatMessage
    error?: string
    forward?: { attempted?: boolean; delivered?: boolean; runId?: string; reason?: string }
  }

  if (!response.ok) {
    const err =
      typeof data.error === 'string' && data.error
        ? data.error
        : response.status === 401 || response.status === 403
          ? '请重新登录后再试'
          : '发送失败'
    return { ok: false, error: err }
  }

  const { chatMessages: allBefore, setChatMessages, currentUser, setAwaitingReply } = useXClawStore.getState()
  if (data.message) {
    setChatMessages(mergeConversationIntoMessages(allBefore, convId, [data.message], currentUser))
  }

  const attempted = Boolean(data?.forward?.attempted)
  const delivered = Boolean(data?.forward?.delivered)
  if (attempted && !delivered) {
    const reason = typeof data.forward?.reason === 'string' ? data.forward.reason.trim() : ''
    return {
      ok: false,
      error: reason ? `网关未接受消息：${reason}` : '网关未接受消息，请检查网关连接与配置。',
    }
  }

  const userMsg = data.message
  const userTs =
    userMsg && typeof userMsg.created_at === 'number' ? userMsg.created_at : Math.floor(Date.now() / 1000)

  const runId = typeof data?.forward?.runId === 'string' ? data.forward.runId : null
  const latest = useXClawStore.getState().chatMessages
  const scoped = latest.filter((m) => m.conversation_id === convId && m.created_at >= userTs - 3)
  const alreadyDone = hasPersistedAssistantFinalForConversation(scoped, convId, currentUser)
  if (delivered && runId && !alreadyDone) {
    setAwaitingReply({ waiting: true, conversationId: convId, runId })
  } else {
    setAwaitingReply({ waiting: false })
  }

  const awaitAssistantReply = options?.awaitAssistantReply !== false

  if (!awaitAssistantReply) {
    useXClawStore.getState().setAwaitingReply({ waiting: false })
    return { ok: true, reply: null, conversationId: convId, userMessageCreatedAt: userTs }
  }

  try {
    const reply = await pollStudioAssistantReply(convId, userTs, 90_000)
    return { ok: true, reply, conversationId: convId, userMessageCreatedAt: userTs }
  } finally {
    useXClawStore.getState().setAwaitingReply({ waiting: false })
  }
}
