'use client'

/**
 * 在「工作室」标签下 ChatPanel 未挂载时，仍对当前会话做 DB 增量同步与偶发网关拉取，
 * 与 ChatPanel 内 runIncrementalSync 行为对齐（简化版），避免 Studio 发消息后助手落库但主进程无轮询。
 */
import { useEffect, useRef } from 'react'
import { useXClawStore, type ChatMessage } from '@/store'
import {
  fetchConversationMessages,
  hydrateChatMessagesAttachments,
  maxCreatedAtForConversation,
  mergeConversationIntoMessages,
  normalizeChatMessagesForStore,
  sinceQueryParamFromMaxCreatedAt,
} from '@/lib/chat-sync'
import { isPendingConversation } from '@/lib/pending-conversation'
import { hasPersistedAssistantFinalForConversation } from '@/lib/awaiting-reply'

const POLL_MS = 2800

function filterObsoleteStatusMessages(messages: ChatMessage[], conversationId: string): ChatMessage[] {
  return messages.filter((m) => {
    if (m.conversation_id !== conversationId) return true
    if (m.message_type !== 'status') return true
    const meta = m.metadata as Record<string, unknown> | undefined
    if (!meta) return true
    const phase = String(meta.phase || '').toLowerCase()
    if (phase === 'final') return false
    if (phase === 'error') return true
    const status = String(meta.status || '').toLowerCase()
    if (status !== 'accepted' && status !== 'processing') return true
    return false
  })
}

export function StudioConversationBridge() {
  const activeConversation = useXClawStore((s) => s.activeConversation)
  const lastGatewayPullAtRef = useRef(0)
  const lastFullFetchAtRef = useRef(0)

  useEffect(() => {
    if (!activeConversation || isPendingConversation(activeConversation)) return
    const id = activeConversation
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      if (useXClawStore.getState().activeConversation !== id) return

      const snap = useXClawStore.getState()
      const awaitingHere =
        snap.isAwaitingReply && snap.awaitingConversationId === id && snap.activeConversation === id

      if (
        awaitingHere &&
        Date.now() - lastGatewayPullAtRef.current >= 6000
      ) {
        lastGatewayPullAtRef.current = Date.now()
        try {
          await fetch('/api/chat/messages/sync-gateway', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ conversation_id: id }),
          })
        } catch {
          // ignore
        }
      }

      const { chatMessages: all, setChatMessages, currentUser } = useXClawStore.getState()
      const max = maxCreatedAtForConversation(all, id)
      const since = sinceQueryParamFromMaxCreatedAt(max)
      let incoming = await fetchConversationMessages(id, {
        since: since ?? undefined,
        limit: 200,
      })

      if (incoming.length === 0 && awaitingHere) {
        const now = Date.now()
        if (now - lastFullFetchAtRef.current >= 12_000) {
          lastFullFetchAtRef.current = now
          incoming = await fetchConversationMessages(id, { limit: 200 })
        }
      }

      if (incoming.length === 0) return

      const merged = mergeConversationIntoMessages(all, id, incoming, currentUser)
      const convMsgs = merged.filter((m) => m.conversation_id === id)
      const hasTerminal = hasPersistedAssistantFinalForConversation(convMsgs, id, currentUser)
      const displayConv = hasTerminal ? filterObsoleteStatusMessages(convMsgs, id) : convMsgs
      setChatMessages(
        normalizeChatMessagesForStore([
          ...merged.filter((m) => m.conversation_id !== id),
          ...displayConv,
        ]),
      )
    }

    const fullLoad = async () => {
      if (cancelled) return
      try {
        const response = await fetch(
          `/api/chat/messages?conversation_id=${encodeURIComponent(id)}&limit=200`,
          { cache: 'no-store', credentials: 'same-origin' },
        )
        const body = (await response.json().catch(() => ({}))) as { messages?: ChatMessage[] }
        if (!response.ok || cancelled) return
        const incoming = hydrateChatMessagesAttachments(
          (Array.isArray(body.messages) ? body.messages : []) as ChatMessage[],
        )
        const { chatMessages: existing, setChatMessages, currentUser } = useXClawStore.getState()
        const merged = normalizeChatMessagesForStore([
          ...existing.filter((msg) => msg.conversation_id !== id),
          ...incoming,
        ])
        const convMsgs = merged.filter((m) => m.conversation_id === id)
        const hasTerminal = hasPersistedAssistantFinalForConversation(convMsgs, id, currentUser)
        const displayConv = hasTerminal ? filterObsoleteStatusMessages(convMsgs, id) : convMsgs
        setChatMessages(
          normalizeChatMessagesForStore([
            ...merged.filter((m) => m.conversation_id !== id),
            ...displayConv,
          ]),
        )
      } catch {
        // keep store
      }
    }

    void fullLoad()
    const t = setInterval(() => void tick(), POLL_MS)
    void tick()
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [activeConversation])

  return null
}
