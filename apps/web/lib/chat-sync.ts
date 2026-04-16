import type { ChatAttachment, ChatMessage, CurrentUser } from '@/store'

/** 与 chat-helpers.isUserChatMessage 对齐的最小子集（lib 层不依赖 components，避免 Vitest 解析失败） */
function isPersistedHumanUserTextForDedupe(message: ChatMessage, currentUser: CurrentUser | null): boolean {
  if (typeof message.id !== 'number' || message.id <= 0) return false
  if (message.message_type !== 'text') return false
  const metadata = (message.metadata || {}) as Record<string, unknown>
  const senderType = String(metadata.senderType || '').toLowerCase()
  if (senderType === 'user') return true
  const from = String(message.from_agent || '').trim().toLowerCase()
  if (from === 'you') return true
  if (String(metadata.role || '').toLowerCase() === 'user') return true
  const u = currentUser?.username?.trim().toLowerCase()
  const d = currentUser?.display_name?.trim().toLowerCase()
  if (u && from === u) return true
  if (d && from === d) return true
  const emailLocal = currentUser?.email?.split('@')[0]?.trim().toLowerCase()
  if (emailLocal && from === emailLocal) return true
  return false
}

/** GET/SSE 有时仅带 metadata.attachments；气泡展示用顶层 attachments */
export function hydrateMessageAttachmentsFromMetadata<M extends ChatMessage>(msg: M): M {
  const top = msg.attachments
  if (Array.isArray(top) && top.length > 0) return msg
  const meta = msg.metadata as Record<string, unknown> | undefined
  const fromMeta = meta?.attachments
  if (Array.isArray(fromMeta) && fromMeta.length > 0) {
    return { ...msg, attachments: fromMeta as ChatAttachment[] }
  }
  return msg
}

export function hydrateChatMessagesAttachments(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(hydrateMessageAttachmentsFromMetadata)
}

/** 全局按时间排序，避免 setChatMessages 的 slice(-500) 截断错会话 */
export function normalizeChatMessagesForStore(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at - b.created_at
    return a.id - b.id
  })
}

/** 会话内已持久化消息的最大 created_at（秒），忽略临时负 id） */
export function maxCreatedAtForConversation(messages: ChatMessage[], conversationId: string): number {
  let max = 0
  for (const m of messages) {
    if (m.conversation_id !== conversationId) continue
    if (typeof m.id === 'number' && m.id < 0) continue
    if (typeof m.created_at === 'number' && m.created_at > max) max = m.created_at
  }
  return max
}

/**
 * GET 使用 `created_at > since`，用 max-1 避免同秒多条时漏消息；会与已有 id 去重合并。
 */
export function sinceQueryParamFromMaxCreatedAt(maxCreatedAt: number): number | null {
  if (maxCreatedAt <= 0) return null
  return Math.max(0, maxCreatedAt - 1)
}

export async function fetchConversationMessages(
  conversationId: string,
  opts: { since?: number | null; limit?: number; signal?: AbortSignal }
): Promise<ChatMessage[]> {
  const limit = Math.min(opts.limit ?? 200, 200)
  const params = new URLSearchParams({
    conversation_id: conversationId,
    limit: String(limit),
  })
  if (opts.since != null && opts.since >= 0) {
    params.set('since', String(opts.since))
  }
  const res = await fetch(`/api/chat/messages?${params.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
  if (!res.ok) return []
  const data = (await res.json().catch(() => ({}))) as { messages?: ChatMessage[] }
  return hydrateChatMessagesAttachments(Array.isArray(data.messages) ? data.messages : [])
}

function normalizeContentForOptimisticDedupe(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * 若会话内已存在同内容的正 id 用户文本，则移除对应的负 id 乐观消息（避免双气泡）。
 * 乐观发送固定 from_agent=you，库行多为登录用户名 + metadata.senderType=user，不能靠 from 字符串相等判断。
 */
export function dropDuplicateOptimisticUserRows(
  convMessages: ChatMessage[],
  currentUser: CurrentUser | null = null,
): ChatMessage[] {
  const negatives = convMessages.filter(
    (m) => typeof m.id === 'number' && m.id < 0 && m.message_type === 'text',
  )
  if (negatives.length === 0) return convMessages

  const positives = convMessages.filter(
    (m) => typeof m.id === 'number' && m.id > 0 && m.message_type === 'text',
  )
  const dropIds = new Set<number>()
  for (const neg of negatives) {
    const n = normalizeContentForOptimisticDedupe(neg.content)
    if (!n) continue
    const from = String(neg.from_agent || '')
    const negIsOptimisticClient = from.trim().toLowerCase() === 'you'
    if (!negIsOptimisticClient) continue

    const hit = positives.some((p) => {
      if (!isPersistedHumanUserTextForDedupe(p, currentUser)) return false
      if (normalizeContentForOptimisticDedupe(p.content) !== n) return false
      if (Math.abs(p.created_at - neg.created_at) > 300) return false
      return true
    })
    if (hit) dropIds.add(neg.id)
  }
  if (dropIds.size === 0) return convMessages
  return convMessages.filter((m) => !dropIds.has(m.id))
}

/** 将增量消息合并进 store 列表（同 id 后者覆盖，便于补全 metadata） */
export function mergeConversationIntoMessages(
  allMessages: ChatMessage[],
  conversationId: string,
  incoming: ChatMessage[],
  currentUser: CurrentUser | null = null,
): ChatMessage[] {
  const other = allMessages.filter((m) => m.conversation_id !== conversationId)
  const forConv = allMessages.filter((m) => m.conversation_id === conversationId)
  const merged = new Map<number, ChatMessage>()
  for (const m of forConv) merged.set(m.id, m)
  for (const m of incoming) {
    if (m.conversation_id !== conversationId) continue
    const prev = merged.get(m.id)
    merged.set(
      m.id,
      prev
        ? {
            ...prev,
            ...m,
            metadata: {
              ...(typeof prev.metadata === 'object' && prev.metadata !== null ? prev.metadata : {}),
              ...(typeof m.metadata === 'object' && m.metadata !== null ? m.metadata : {}),
            } as ChatMessage['metadata'],
          }
        : m
    )
  }
  let nextConv = Array.from(merged.values())
    .map(hydrateMessageAttachmentsFromMetadata)
    .sort((a, b) => a.created_at - b.created_at)
  nextConv = dropDuplicateOptimisticUserRows(nextConv, currentUser)
  return normalizeChatMessagesForStore([...other, ...nextConv])
}
