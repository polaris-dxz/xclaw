'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Loader2 } from 'lucide-react'
import { buildStudioBaseUrl, buildStudioEmbedUrl, buildStudioHealthUrl } from '@/lib/studio/runtime'
import { pollStudioAssistantReply, sendStudioChatMessage } from '@/lib/studio/send-studio-chat'
import { chatMessagesToStudioWire } from '@/lib/studio/studio-history-wire'
import { hydrateChatMessagesAttachments } from '@/lib/chat-sync'
import {
  STUDIO_CHAT_CONTEXT,
  STUDIO_CHAT_HISTORY,
  STUDIO_CHAT_REQUEST_HISTORY,
  STUDIO_CHAT_REPLY_UPDATE,
  STUDIO_CHAT_RESULT,
  STUDIO_CHAT_SEND,
  type StudioChatHistoryPayload,
  type StudioChatReplyUpdatePayload,
  type StudioChatResultPayload,
} from '@/lib/studio/studio-chat-protocol'
import { studioEmbedOriginsCompatible } from '@/lib/studio/studio-embed-origin'
import { useXClawStore, type ChatMessage } from '@/store'
import { Button } from '@/components/ui/button'

export function StudioPanel() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const mountedRef = useRef(true)
  const [studioUrl, setStudioUrl] = useState<string>('')
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const activeConversation = useXClawStore((s) => s.activeConversation)

  const pushChatContextToIframe = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win || !studioUrl) return
    try {
      // 使用 *：Studio 实际 URL 可能是 localhost:PORT 而 health 返回 127.0.0.1:PORT，严格 origin 会导致消息被浏览器丢弃。
      win.postMessage({ type: STUDIO_CHAT_CONTEXT, conversationId: activeConversation ?? null }, '*')
    } catch {
      // ignore invalid studioUrl
    }
  }, [studioUrl, activeConversation])

  const runHealthCheck = useCallback(async () => {
    const electronApi = (window as Window & { electronAPI?: { getStudioBaseUrl?: () => Promise<string> } }).electronAPI
    let baseUrl: string
    if (electronApi?.getStudioBaseUrl) {
      try {
        baseUrl = await electronApi.getStudioBaseUrl()
      } catch {
        baseUrl = buildStudioBaseUrl(process.env.NEXT_PUBLIC_STUDIO_PORT)
      }
    } else {
      baseUrl = buildStudioBaseUrl(process.env.NEXT_PUBLIC_STUDIO_PORT)
    }

    if (!mountedRef.current) return
    setStudioUrl(baseUrl)
    setStatus('checking')

    const healthUrl = buildStudioHealthUrl(baseUrl)
    try {
      const res = await fetch(healthUrl, {
        cache: 'no-store',
        method: 'GET',
      })
      const ok = res.ok
      let bodyOk = ok
      if (ok) {
        try {
          const data = (await res.json()) as { status?: string }
          bodyOk = data?.status === 'ok'
        } catch {
          bodyOk = false
        }
      }
      if (!mountedRef.current) return
      setStatus(bodyOk ? 'online' : 'offline')
    } catch {
      if (!mountedRef.current) return
      setStatus('offline')
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void runHealthCheck()
    return () => {
      mountedRef.current = false
    }
  }, [runHealthCheck])

  useEffect(() => {
    pushChatContextToIframe()
  }, [pushChatContextToIframe])

  useEffect(() => {
    const postToIframe = (
      payload:
        | StudioChatResultPayload
        | StudioChatHistoryPayload
        | StudioChatReplyUpdatePayload,
      target: Window | null | undefined,
    ) => {
      const win = target ?? iframeRef.current?.contentWindow
      if (!win) return
      if (!target && !studioUrl) return
      try {
        win.postMessage(payload, '*')
      } catch {
        // ignore
      }
    }

    const onMessage = async (ev: MessageEvent) => {
      const replyTarget =
        ev.source && typeof (ev.source as Window).postMessage === 'function'
          ? (ev.source as Window)
          : null
      if (!replyTarget) return
      if (!studioUrl) return
      let expectedOrigin: string
      try {
        expectedOrigin = new URL(studioUrl).origin
      } catch {
        return
      }
      if (!studioEmbedOriginsCompatible(ev.origin, expectedOrigin)) return

      const data = ev.data as {
        type?: string
        requestId?: string
        text?: string
        conversationId?: string
      }
      if (!data?.type) return

      if (data.type === STUDIO_CHAT_REQUEST_HISTORY) {
        const requestId = typeof data.requestId === 'string' ? data.requestId : ''
        const conversationId = typeof data.conversationId === 'string' ? data.conversationId.trim() : ''
        if (!requestId || !conversationId) {
          postToIframe(
            {
              type: STUDIO_CHAT_HISTORY,
              requestId: requestId || 'unknown',
              ok: false,
              error: '缺少 conversationId',
            },
            replyTarget,
          )
          return
        }
        try {
          const res = await fetch(
            `/api/chat/messages?conversation_id=${encodeURIComponent(conversationId)}&limit=200`,
            { cache: 'no-store', credentials: 'include' },
          )
          const body = (await res.json().catch(() => ({}))) as { messages?: ChatMessage[]; error?: string }
          if (!res.ok) {
            postToIframe(
              {
                type: STUDIO_CHAT_HISTORY,
                requestId,
                ok: false,
                error: typeof body.error === 'string' && body.error.trim()
                  ? body.error
                  : `HTTP ${res.status}`,
              },
              replyTarget,
            )
            return
          }
          const raw = Array.isArray(body.messages) ? body.messages : []
          const hydrated = hydrateChatMessagesAttachments(raw as ChatMessage[])
          const currentUser = useXClawStore.getState().currentUser
          const messages = chatMessagesToStudioWire(hydrated, currentUser)
          postToIframe({ type: STUDIO_CHAT_HISTORY, requestId, ok: true, messages }, replyTarget)
        } catch (e: unknown) {
          postToIframe(
            {
              type: STUDIO_CHAT_HISTORY,
              requestId,
              ok: false,
              error: e instanceof Error && e.message.trim() ? e.message : '加载历史失败',
            },
            replyTarget,
          )
        }
        return
      }

      if (data.type !== STUDIO_CHAT_SEND || typeof data.requestId !== 'string') return
      const text = typeof data.text === 'string' ? data.text : ''

      const replyPayload = (partial: Omit<StudioChatResultPayload, 'type' | 'requestId'> & { requestId: string }) => {
        const ok = Boolean(partial.ok)
        const errTrim =
          typeof partial.error === 'string' && partial.error.trim() ? partial.error.trim() : ''
        if (ok) {
          const reply = typeof partial.reply === 'string' ? partial.reply : ''
          postToIframe(
            { type: STUDIO_CHAT_RESULT, requestId: partial.requestId, ok: true, reply },
            replyTarget,
          )
          return
        }
        postToIframe(
          {
            type: STUDIO_CHAT_RESULT,
            requestId: partial.requestId,
            ok: false,
            error: errTrim || '发送失败',
          },
          replyTarget,
        )
      }

      try {
        const result = await sendStudioChatMessage(text, { awaitAssistantReply: false })
        if (!result.ok) {
          replyPayload({ requestId: data.requestId, ok: false, error: result.error })
          return
        }
        const firstReply = typeof result.reply === 'string' ? result.reply : ''
        replyPayload({ requestId: data.requestId, ok: true, reply: firstReply })

        const { conversationId, userMessageCreatedAt } = result
        const targetWin = replyTarget
        const studioRequestId = data.requestId
        void pollStudioAssistantReply(conversationId, userMessageCreatedAt, 90_000).then((late) => {
          const t = late?.trim()
          if (!t) {
            postToIframe(
              { type: STUDIO_CHAT_REPLY_UPDATE, requestId: studioRequestId, reply: '' },
              targetWin,
            )
            return
          }
          if (firstReply.trim() === t) return
          postToIframe(
            { type: STUDIO_CHAT_REPLY_UPDATE, requestId: studioRequestId, reply: t },
            targetWin,
          )
        })
      } catch (e: unknown) {
        replyPayload({
          requestId: data.requestId,
          ok: false,
          error: e instanceof Error && e.message.trim() ? e.message : '发送失败',
        })
      }
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [studioUrl])

  /** 仅在后端 /health 通过后再挂 iframe，避免未就绪时白屏 */
  if (studioUrl && status === 'online') {
    return (
      <div className="relative flex-1 h-full min-h-0 overflow-hidden">
        <iframe
          ref={iframeRef}
          title="Star Office Studio"
          src={buildStudioEmbedUrl(studioUrl)}
          className="block h-full min-h-0 w-full border-0"
          onLoad={() => {
            pushChatContextToIframe()
            requestAnimationFrame(() => pushChatContextToIframe())
          }}
        />
      </div>
    )
  }

  const isChecking = status === 'checking'

  return (
    <div className="flex-1 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center max-w-lg px-6"
      >
        <motion.div
          animate={{
            rotate: isChecking ? [0, 8, -8, 0] : [0, 0, 0],
            scale: isChecking ? [1, 1.08, 1] : [1, 1, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            repeatDelay: 1,
          }}
          className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary/10 mb-6"
        >
          {isChecking ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : (
            <AlertCircle className="h-10 w-10 text-destructive" />
          )}
        </motion.div>

        <h2 className="text-2xl font-semibold mb-2">
          {isChecking ? '工作室正在接入' : '无法连接工作室后端'}
        </h2>
        <p className="text-muted-foreground mb-4">
          {isChecking
            ? '正在检查 Star Office 后端状态...'
            : '请确认 Studio API（Python）已启动；桌面端需从主进程成功拉起 studio-api，或在本机先运行 pnpm dev:studio-api。'}
        </p>
        <p className="text-xs text-muted-foreground/80 mb-4">
          目标地址：{studioUrl || buildStudioBaseUrl(process.env.NEXT_PUBLIC_STUDIO_PORT)}
        </p>
        <Button
          type="button"
          onClick={() => void runHealthCheck()}
          variant="outline"
          size="sm"
          disabled={isChecking}
        >
          {isChecking ? '检查中…' : '重新检查'}
        </Button>
      </motion.div>
    </div>
  )
}
