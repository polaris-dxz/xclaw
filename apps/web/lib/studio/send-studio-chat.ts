/**
 * Studio 侧栏发消息：与主界面 ChatPanel 使用同一会话与 /api/chat/messages 链路。
 */
import {
  useXClawStore,
  type ChatMessage,
  type Conversation,
} from '@/store'
import { resolveOutgoingRecipient, stripInlinedAttachmentPreviewFromUserContent } from '@/components/chat/chat-helpers'
import { isPendingConversation } from '@/lib/pending-conversation'
import { setConversationTitleOverride } from '@/lib/conversation-title-overrides'
import { buildFirstMessageSessionLabel } from '@/lib/session-label'
import { fetchConversationMessages } from '@/lib/chat-sync'
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

/** 轮询直到出现用户消息之后的助手可见回复（或超时） */
async function pollAssistantReplyText(
  conversationId: string,
  userMessageCreatedAt: number,
  maxMs: number
): Promise<string | null> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const msgs = await fetchConversationMessages(conversationId, {
      since: Math.max(0, userMessageCreatedAt - 1),
      limit: 80,
    })
    const afterUser = msgs.filter(
      (m) => m.conversation_id === conversationId && m.created_at > userMessageCreatedAt
    )
    const assistant = [...afterUser].reverse().find((m) => {
      if (m.from_agent === 'you') return false
      if (m.message_type === 'status') return false
      const raw = String(m.content || '').trim()
      return raw.length > 0
    })
    if (assistant) {
      return stripInlinedAttachmentPreviewFromUserContent(String(assistant.content || '')).trim() || null
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

export type SendStudioChatResult =
  | { ok: true; reply: string | null; conversationId: string }
  | { ok: false; error: string }

/**
 * 使用当前侧栏 activeConversation 与主输入区同款收件人解析（sessionStorage + 会话 id）。
 */
export async function sendStudioChatMessage(trimmedText: string): Promise<SendStudioChatResult> {
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
    forward?: { attempted?: boolean; delivered?: boolean; runId?: string }
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

  const userMsg = data.message
  const userTs =
    userMsg && typeof userMsg.created_at === 'number' ? userMsg.created_at : Math.floor(Date.now() / 1000)

  const reply = await pollAssistantReplyText(convId, userTs, 90_000)
  return { ok: true, reply, conversationId: convId }
}
