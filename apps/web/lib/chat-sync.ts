import type { ChatAttachment, ChatMessage } from '@/store'

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
  opts: { since?: number | null; limit?: number }
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
  })
  if (!res.ok) return []
  const data = (await res.json().catch(() => ({}))) as { messages?: ChatMessage[] }
  return hydrateChatMessagesAttachments(Array.isArray(data.messages) ? data.messages : [])
}

/** 将增量消息合并进 store 列表（同 id 后者覆盖，便于补全 metadata） */
export function mergeConversationIntoMessages(
  allMessages: ChatMessage[],
  conversationId: string,
  incoming: ChatMessage[]
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
  const nextConv = Array.from(merged.values())
    .map(hydrateMessageAttachmentsFromMetadata)
    .sort((a, b) => a.created_at - b.created_at)
  return normalizeChatMessagesForStore([...other, ...nextConv])
}
