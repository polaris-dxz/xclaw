'use client'

import { useRef, useEffect, useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageItem } from './message-item'
import { MessageInput, type ChatTokenUsageLine } from './message-input'
import {
  useXClawStore,
  type ChatAttachment,
  type ChatMessage,
  type Conversation,
  type CurrentUser,
  shouldClearAwaitingReplyForMessage,
} from '@/store'
import { hasPersistedAssistantFinalForConversation } from '@/lib/awaiting-reply'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  filterVisibleChatMessagesForList,
  groupMessagesForDisplay,
  resolveOutgoingRecipient,
} from './chat-helpers'
import {
  fetchConversationMessages,
  hydrateChatMessagesAttachments,
  maxCreatedAtForConversation,
  mergeConversationIntoMessages,
  normalizeChatMessagesForStore,
  sinceQueryParamFromMaxCreatedAt,
} from '@/lib/chat-sync'
import { isPendingConversation } from '@/lib/pending-conversation'
import { setConversationTitleOverride } from '@/lib/conversation-title-overrides'
import { buildFirstMessageSessionLabel } from '@/lib/session-label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Bot, Loader2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

const POLL_INTERVAL_MS = 3000
/** 增量为空但仍在等待时，隔多久做一次全量拉取（防 since 过高漏消息） */
const FULL_FETCH_FALLBACK_MS = 12000
/** agent.wait 超时后从 Gateway 拉终稿，节流避免打爆 Gateway */
const GATEWAY_PULL_MIN_INTERVAL_MS = 6000
/** 发送成功后一段时间内仍增量拉取，覆盖 SSE 未送达、agent.wait 超时后晚落库 */
const POST_SEND_POLL_WINDOW_MS = 180_000
/** 最大等待时间，超过后自动清除等待状态（需 >= 服务端 agent.wait 120s + CLI extra 20s + 余量） */
const MAX_AWAIT_TIMEOUT_MS = 150_000

function dedupeMessagesById(messages: ChatMessage[]): ChatMessage[] {
  const bucket = new Map<string, ChatMessage>()
  for (const message of messages) {
    bucket.set(`${message.conversation_id}:${message.id}`, message)
  }
  return Array.from(bucket.values()).sort((a, b) => a.created_at - b.created_at)
}

/** 与 store.addChatMessage 同一规则：是否已有应结束等待的消息（避免 POST 晚到再次打开等待态） */
function hasAssistantTerminalForRun(
  messages: ChatMessage[],
  conversationId: string,
  runId: string | null,
  currentUser: CurrentUser | null,
): boolean {
  if (runId) {
    return messages.some((m) =>
      shouldClearAwaitingReplyForMessage(
        {
          isAwaitingReply: true,
          awaitingConversationId: conversationId,
          awaitingRunId: runId,
          currentUser,
        },
        m,
      ),
    )
  }
  return hasPersistedAssistantFinalForConversation(messages, conversationId, currentUser)
}

/** 过滤掉不应显示的 status 消息 */
function filterObsoleteStatusMessages(messages: ChatMessage[], conversationId: string): ChatMessage[] {
  return messages.filter((m) => {
    if (m.conversation_id !== conversationId) return true
    if (m.message_type !== 'status') return true
    const meta = m.metadata as Record<string, unknown> | undefined
    if (!meta) return true
    const status = String(meta.status || '').toLowerCase()
    const phase = String(meta.phase || '').toLowerCase()
    // phase=final 的 status 消息是兜底提示（如"已完成处理"），不向用户展示
    if (phase === 'final') return false
    if (phase === 'error') return true
    if (status !== 'accepted' && status !== 'processing') return true
    return false
  })
}

function clearAwaitingIfNeeded(conversationId: string, merged: ChatMessage[], requestedAt?: number) {
  const snap = useXClawStore.getState()
  if (!snap.isAwaitingReply) return

  // 超时自动清除等待状态（防御性措施）
  if (requestedAt && Date.now() - requestedAt > MAX_AWAIT_TIMEOUT_MS) {
    snap.setAwaitingReply({ waiting: false })
    return
  }

  const conv = merged.filter((m) => m.conversation_id === conversationId)

  if (
    conv.some((m) =>
      shouldClearAwaitingReplyForMessage(
        {
          isAwaitingReply: true,
          awaitingConversationId: snap.awaitingConversationId,
          awaitingRunId: snap.awaitingRunId,
          currentUser: snap.currentUser,
        },
        m
      )
    )
  ) {
    snap.setAwaitingReply({ waiting: false })
  }
}

export function ChatPanel() {
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  /** 同步防抖：避免连点/回车连发在 isSendingMessage 更新前打出第二发（会双插 DB、双气泡、双次网关） */
  const sendInFlightRef = useRef(false)
  const postPollUntilRef = useRef(0)
  const postPollConversationRef = useRef<string | null>(null)
  const lastFullFetchAtRef = useRef(0)
  const lastGatewayPullAtRef = useRef(0)
  const awaitingRequestedAtRef = useRef<number | null>(null)

  const {
    conversations,
    activeConversation,
    chatMessages,
    agents,
    setAgents,
    setChatMessages,
    addChatMessage,
    replacePendingMessage,
    updatePendingMessage,
    removePendingMessage,
    setIsSendingMessage,
    setAwaitingReply,
    currentUser,
    updateConversation,
    setConversations,
    setActiveConversation,
  } = useXClawStore()

  const isAwaitingReply = useXClawStore((s) => s.isAwaitingReply)
  const awaitingConversationId = useXClawStore((s) => s.awaitingConversationId)

  const [tokenUsage, setTokenUsage] = useState<ChatTokenUsageLine | null>(null)
  const [tokenUsageLoading, setTokenUsageLoading] = useState(false)
  /** POST /api/chat/messages 往返期间为当前会话 id，与 isAwaitingReply 衔接，避免「等 runId 才出 loading」的空窗 */
  const [postForwardLoadingConversationId, setPostForwardLoadingConversationId] = useState<string | null>(null)

  const fetchTokenUsage = useCallback(async () => {
    const id = useXClawStore.getState().activeConversation
    if (!id?.startsWith('gw:')) {
      setTokenUsage(null)
      setTokenUsageLoading(false)
      return
    }
    setTokenUsageLoading(true)
    try {
      const res = await fetch(
        `/api/chat/session-usage?conversation_id=${encodeURIComponent(id)}`,
        { cache: 'no-store' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.available) {
        setTokenUsage(null)
        return
      }
      setTokenUsage({
        used: Number(data.used || 0),
        contextLimit: Number(data.contextLimit || 0),
        contextIsEstimated: Boolean(data.contextIsEstimated),
        pct: typeof data.pct === 'number' ? data.pct : null,
      })
    } catch {
      setTokenUsage(null)
    } finally {
      setTokenUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTokenUsage()
    const t = setInterval(() => void fetchTokenUsage(), 20000)
    return () => clearInterval(t)
  }, [activeConversation, fetchTokenUsage])

  const selectedConversation = conversations.find((c) => c.id === activeConversation)
  const selectedMessages = dedupeMessagesById(
    filterVisibleChatMessagesForList(chatMessages.filter((msg) => msg.conversation_id === activeConversation)),
  )
  const displayGroups = groupMessagesForDisplay(selectedMessages, currentUser)
  const showGatewayAwaitingLoader =
    Boolean(activeConversation) &&
    (postForwardLoadingConversationId === activeConversation ||
      (isAwaitingReply && awaitingConversationId === activeConversation))

  const runIncrementalSync = useCallback(async (conversationId: string) => {
    if (isPendingConversation(conversationId)) return

    const pre = useXClawStore.getState()
    const awaitingPre =
      pre.isAwaitingReply &&
      pre.awaitingConversationId === conversationId &&
      pre.activeConversation === conversationId
    const inPostWindowPre =
      postPollUntilRef.current > Date.now() && postPollConversationRef.current === conversationId

    if (
      (awaitingPre || inPostWindowPre) &&
      Date.now() - lastGatewayPullAtRef.current >= GATEWAY_PULL_MIN_INTERVAL_MS
    ) {
      lastGatewayPullAtRef.current = Date.now()
      try {
        await fetch('/api/chat/messages/sync-gateway', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ conversation_id: conversationId }),
        })
      } catch {
        // ignore — 仍走下方 DB 增量
      }
    }

    const { chatMessages: all, setChatMessages } = useXClawStore.getState()
    const max = maxCreatedAtForConversation(all, conversationId)
    const since = sinceQueryParamFromMaxCreatedAt(max)

    let incoming = await fetchConversationMessages(conversationId, {
      since: since ?? undefined,
      limit: 200,
    })

    const snap = useXClawStore.getState()
    const awaiting =
      snap.isAwaitingReply &&
      snap.awaitingConversationId === conversationId &&
      snap.activeConversation === conversationId

    /** 本地 max 因 SSE 时间戳偏大时，增量可能一直为空；定期全量一页兜底 */
    if (incoming.length === 0 && awaiting) {
      const now = Date.now()
      if (now - lastFullFetchAtRef.current >= FULL_FETCH_FALLBACK_MS) {
        lastFullFetchAtRef.current = now
        incoming = await fetchConversationMessages(conversationId, { limit: 200 })
      }
    }

    if (incoming.length === 0) {
      clearAwaitingIfNeeded(conversationId, all, awaitingRequestedAtRef.current ?? undefined)
      return
    }

    const merged = mergeConversationIntoMessages(all, conversationId, incoming)

    // 检查是否收到了助手终稿，如果是则过滤掉过时的 status 消息
    const hasTerminal = hasAssistantTerminalForRun(merged, conversationId, null, useXClawStore.getState().currentUser)
    const filtered = hasTerminal ? filterObsoleteStatusMessages(merged, conversationId) : merged

    setChatMessages(filtered)
    clearAwaitingIfNeeded(conversationId, filtered, awaitingRequestedAtRef.current ?? undefined)
  }, [])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollViewportRef.current) {
      scrollViewportRef.current.scrollTop = scrollViewportRef.current.scrollHeight
    }
  }, [
    selectedMessages.length,
    activeConversation,
    isAwaitingReply,
    awaitingConversationId,
    postForwardLoadingConversationId,
  ])

  // 切换会话：全量拉取（避免仅靠增量无基准）
  useEffect(() => {
    if (!activeConversation) return
    if (isPendingConversation(activeConversation)) return
    let cancelled = false
    const loadMessages = async () => {
      try {
        const response = await fetch(
          `/api/chat/messages?conversation_id=${encodeURIComponent(activeConversation)}&limit=200`,
          { cache: 'no-store' }
        )
        const data = await response.json()
        if (!response.ok || cancelled) return
        const incoming = hydrateChatMessagesAttachments(
          (Array.isArray(data.messages) ? data.messages : []) as ChatMessage[],
        )
        const { chatMessages: existing, setChatMessages, currentUser } = useXClawStore.getState()
        const merged = normalizeChatMessagesForStore(
          dedupeMessagesById([
            ...existing.filter((msg) => msg.conversation_id !== activeConversation),
            ...incoming,
          ]),
        )
        const convMsgs = merged.filter((m) => m.conversation_id === activeConversation)
        /** 与 runIncrementalSync 一致：已有助手终稿时，不再展示库里残留的 accepted/processing + thinking 状态行（否则刷新后仍见「已接收请求」转圈） */
        const hasTerminal = hasAssistantTerminalForRun(convMsgs, activeConversation, null, currentUser)
        const displayConv = hasTerminal ? filterObsoleteStatusMessages(convMsgs, activeConversation) : convMsgs
        setChatMessages(
          normalizeChatMessagesForStore([
            ...merged.filter((m) => m.conversation_id !== activeConversation),
            ...displayConv,
          ]),
        )
      } catch {
        // keep existing cached messages on fetch failures
      }
    }
    void loadMessages()
    return () => {
      cancelled = true
    }
  }, [activeConversation, setChatMessages])

  // 等待回复 / 发送后窗口内：增量轮询 DB（since），补齐 SSE 漏推、晚落库
  useEffect(() => {
    if (!activeConversation) return
    if (isPendingConversation(activeConversation)) return
    const id = activeConversation
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      const state = useXClawStore.getState()
      if (state.activeConversation !== id) return

      const inPostWindow =
        postPollUntilRef.current > Date.now() && postPollConversationRef.current === id
      const awaitingHere =
        state.isAwaitingReply &&
        state.awaitingConversationId === id &&
        state.activeConversation === id
      const needPoll = awaitingHere || inPostWindow
      if (!needPoll) return

      await runIncrementalSync(id)
    }

    const t = setInterval(tick, POLL_INTERVAL_MS)
    void tick()
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [activeConversation, runIncrementalSync])

  // 页签切回前台：补一次增量
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      const id = useXClawStore.getState().activeConversation
      if (!id) return
      void runIncrementalSync(id)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [runIncrementalSync])

  // SSE 重连成功：补一次增量
  useEffect(() => {
    const onSseOpen = () => {
      const id = useXClawStore.getState().activeConversation
      if (!id) return
      void runIncrementalSync(id)
    }
    window.addEventListener('xclaw:sse-open', onSseOpen)
    return () => window.removeEventListener('xclaw:sse-open', onSseOpen)
  }, [runIncrementalSync])

  useEffect(() => {
    if (agents.length > 0) return
    let cancelled = false
    const loadAgents = async () => {
      try {
        const response = await fetch('/api/agents?limit=200', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || cancelled) return
        setAgents(Array.isArray(data.agents) ? data.agents : [])
      } catch {
        // ignore mention candidates bootstrap failures
      }
    }
    void loadAgents()
    return () => {
      cancelled = true
    }
  }, [agents.length, setAgents])

  const handleSendMessage = async (
    content: string,
    attachments?: ChatAttachment[],
    selectedAgent?: string,
    selectedModel?: string
  ) => {
    if (sendInFlightRef.current) return
    sendInFlightRef.current = true

    try {
    if (!activeConversation) return

    let convId = activeConversation

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
          toast({
            title: '无法创建网关会话',
            description:
              typeof sessionData.error === 'string' && sessionData.error
                ? sessionData.error
                : sessionRes.status === 401 || sessionRes.status === 403
                  ? '请重新登录后再试。'
                  : '请检查网关或稍后重试。',
            variant: 'destructive',
          })
          return
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
        toast({
          title: '创建会话失败',
          description: '请稍后重试。',
          variant: 'destructive',
        })
        return
      }
    }

    const tempId = -Date.now()
    const { to, content: cleanContent } = resolveOutgoingRecipient({
      content,
      activeConversation: convId,
      selectedAgent,
      fallbackAgent: process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'main',
    })

    const priorForConv = useXClawStore.getState().chatMessages.filter((m) => m.conversation_id === convId).length
    if (priorForConv === 0) {
      const sk = convId.startsWith('gw:') ? convId.slice(3) : ''
      const attachmentNames = attachments?.map((a) => a.name).filter(Boolean) as string[] | undefined
      const optimisticTitle = buildFirstMessageSessionLabel(cleanContent, sk, attachmentNames)
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
          toast({
            title: '会话标题未同步到网关',
            description: '消息仍会发送；可稍后重试或检查网关连接。',
            variant: 'destructive',
          })
        }
      }
    }

    const pendingMessage: ChatMessage = {
      id: tempId,
      conversation_id: convId,
      from_agent: 'you',
      to_agent: to,
      content: cleanContent,
      message_type: 'text',
      attachments,
      created_at: Math.floor(Date.now() / 1000),
      pendingStatus: 'sending',
    }

    addChatMessage(pendingMessage)
    setIsSendingMessage(true)
    setAwaitingReply({ waiting: false })
    setPostForwardLoadingConversationId(convId)
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: convId,
          to,
          content: cleanContent,
          model: selectedModel || undefined,
          message_type: 'text',
          attachments,
          forward: true,
        }),
      })
      const data = (await response.json()) as {
        message?: ChatMessage
        forward?: { attempted?: boolean; delivered?: boolean; runId?: string; reason?: string }
        jsonl_resync?: boolean
      }
      if (!response.ok) {
        updatePendingMessage(tempId, { pendingStatus: 'failed' })
        setAwaitingReply({ waiting: false })
        return
      }
      if (data?.message) {
        replacePendingMessage(tempId, data.message as ChatMessage)
      } else {
        removePendingMessage(tempId)
      }
      if (data?.jsonl_resync) {
        try {
          const full = await fetchConversationMessages(convId, { limit: 200 })
          const { chatMessages: all, setChatMessages } = useXClawStore.getState()
          const others = all.filter((m) => m.conversation_id !== convId)
          setChatMessages(normalizeChatMessagesForStore([...others, ...full]))
        } catch {
          // 仍依赖下方增量同步
        }
      }
      const delivered = Boolean(data?.forward?.attempted) && Boolean(data?.forward?.delivered)
      if (Boolean(data?.forward?.attempted) && !delivered) {
        const r = typeof data.forward?.reason === 'string' ? data.forward.reason.trim() : ''
        toast({
          title: '网关未接受投递',
          description: r || '请检查网关连接与配置。',
          variant: 'destructive',
        })
      }
      const runId = typeof data?.forward?.runId === 'string' ? data.forward.runId : null
      const userMsg = data?.message as ChatMessage | undefined
      const userTs = typeof userMsg?.created_at === 'number' ? userMsg.created_at : null
      const { chatMessages: latest, currentUser: cu } = useXClawStore.getState()
      const scoped =
        userTs !== null
          ? latest.filter((m) => m.conversation_id === convId && m.created_at >= userTs - 3)
          : latest
      const alreadyDone = hasAssistantTerminalForRun(scoped, convId, runId, cu)
      if (delivered && runId && !alreadyDone) {
        setAwaitingReply({ waiting: true, conversationId: convId, runId })
        awaitingRequestedAtRef.current = Date.now()
      } else {
        setAwaitingReply({ waiting: false })
      }

      postPollUntilRef.current = Date.now() + POST_SEND_POLL_WINDOW_MS
      postPollConversationRef.current = convId
      void runIncrementalSync(convId)
      void fetchTokenUsage()
    } catch {
      updatePendingMessage(tempId, { pendingStatus: 'failed' })
      setAwaitingReply({ waiting: false })
    } finally {
      setPostForwardLoadingConversationId(null)
      setIsSendingMessage(false)
    }
    } finally {
      sendInFlightRef.current = false
    }
  }

  const handleStopGenerating = () => {
    if (awaitingConversationId && activeConversation && awaitingConversationId !== activeConversation) return
    setIsSendingMessage(false)
    setAwaitingReply({ waiting: false })
    setPostForwardLoadingConversationId(null)
  }

  if (!selectedConversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center text-muted-foreground"
        >
          <p className="text-lg font-medium">选择一个对话开始</p>
          <p className="text-sm mt-1">或创建新的对话</p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full overflow-hidden">
      {/* 消息列表 */}
      <ScrollArea className="flex-1 min-h-0 h-full px-6" viewportRef={scrollViewportRef}>
        <div className="max-w-4xl mx-auto py-3">
          <AnimatePresence mode="sync">
            {displayGroups.map((group) => {
              if (group.type === 'user') {
                const message = group.messages[0]
                return (
                  <MessageItem
                    key={`u-${message.id}`}
                    message={message}
                    conversationId={selectedConversation.id}
                  />
                )
              }
              /** 过程类消息（工具 JSON、网关合成 user 等）不单独展示「思考过程」时间线，避免干扰阅读 */
              if (group.type === 'thinking_group') {
                return null
              }
              const message = group.messages[0]
              return (
                <MessageItem
                  key={`a-${message.id}`}
                  message={message}
                  conversationId={selectedConversation.id}
                />
              )
            })}
            {showGatewayAwaitingLoader ? (
              <motion.div
                key="awaiting-assistant-placeholder"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="flex w-full items-start gap-2 py-4"
              >
                <Avatar className="h-9 w-9 shrink-0 border border-border/60">
                  <AvatarFallback className="bg-muted">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                  </AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                  <span>正在生成回复…</span>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* 输入框 */}
      <div className="shrink-0 border-t border-border/40 bg-background">
        <MessageInput
          onSendMessage={handleSendMessage}
          onStopGenerating={handleStopGenerating}
          tokenUsage={tokenUsage}
          tokenUsageLoading={tokenUsageLoading}
        />
      </div>
    </div>
  )
}
