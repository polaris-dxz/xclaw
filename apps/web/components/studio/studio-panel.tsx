'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Loader2 } from 'lucide-react'
import { buildStudioBaseUrl, buildStudioEmbedUrl, buildStudioHealthUrl } from '@/lib/studio/runtime'
import { sendStudioChatMessage } from '@/lib/studio/send-studio-chat'
import {
  STUDIO_CHAT_CONTEXT,
  STUDIO_CHAT_RESULT,
  STUDIO_CHAT_SEND,
  type StudioChatResultPayload,
} from '@/lib/studio/studio-chat-protocol'
import { useXClawStore } from '@/store'
import { Button } from '@/components/ui/button'

export function StudioPanel() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [studioUrl, setStudioUrl] = useState<string>('')
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')
  const activeConversation = useXClawStore((s) => s.activeConversation)

  const pushChatContextToIframe = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win || !studioUrl) return
    try {
      const targetOrigin = new URL(studioUrl).origin
      win.postMessage(
        { type: STUDIO_CHAT_CONTEXT, conversationId: activeConversation ?? null },
        targetOrigin
      )
    } catch {
      // ignore invalid studioUrl
    }
  }, [studioUrl, activeConversation])

  useEffect(() => {
    let cancelled = false

    const resolveBaseUrl = async () => {
      const electronApi = (window as Window & { electronAPI?: { getStudioBaseUrl?: () => Promise<string> } }).electronAPI
      if (electronApi?.getStudioBaseUrl) {
        try {
          return await electronApi.getStudioBaseUrl()
        } catch {
          return buildStudioBaseUrl(process.env.NEXT_PUBLIC_STUDIO_PORT)
        }
      }
      return buildStudioBaseUrl(process.env.NEXT_PUBLIC_STUDIO_PORT)
    }

    const checkHealth = async () => {
      const baseUrl = await resolveBaseUrl()
      if (cancelled) {
        return
      }
      setStudioUrl(baseUrl)
      setStatus('checking')
      try {
        await fetch(buildStudioHealthUrl(baseUrl), {
          cache: 'no-store',
          mode: 'no-cors',
        })
        if (!cancelled) {
          setStatus('online')
        }
      } catch {
        if (!cancelled) {
          setStatus('offline')
        }
      }
    }

    void checkHealth()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    pushChatContextToIframe()
  }, [pushChatContextToIframe])

  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      if (ev.source !== iframeRef.current?.contentWindow) return
      if (!studioUrl) return
      let allowedOrigin: string
      try {
        allowedOrigin = new URL(studioUrl).origin
      } catch {
        return
      }
      if (ev.origin !== allowedOrigin) return

      const data = ev.data as { type?: string; requestId?: string; text?: string }
      if (!data || data.type !== STUDIO_CHAT_SEND || typeof data.requestId !== 'string') return
      const text = typeof data.text === 'string' ? data.text : ''

      const replyPayload = (partial: Omit<StudioChatResultPayload, 'type' | 'requestId'> & { requestId: string }) => {
        const win = iframeRef.current?.contentWindow
        if (!win) return
        const payload: StudioChatResultPayload = {
          type: STUDIO_CHAT_RESULT,
          requestId: partial.requestId,
          ok: partial.ok,
          error: partial.error,
          reply: partial.reply,
        }
        win.postMessage(payload, allowedOrigin)
      }

      const result = await sendStudioChatMessage(text)
      if (!result.ok) {
        replyPayload({ requestId: data.requestId, ok: false, error: result.error })
        return
      }
      const replyText =
        result.reply?.trim() ||
        '消息已发送到当前会话，可在左侧「对话」中查看完整回复与上下文。'
      replyPayload({ requestId: data.requestId, ok: true, reply: replyText })
    }

    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [studioUrl])

  if (studioUrl) {
    return (
      <div className="relative flex-1 h-full min-h-0 overflow-hidden">
        <iframe
          ref={iframeRef}
          title="Star Office Studio"
          src={buildStudioEmbedUrl(studioUrl)}
          className="block h-full min-h-0 w-full border-0"
          onLoad={pushChatContextToIframe}
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

        <h2 className="text-2xl font-semibold mb-2">工作室正在接入</h2>
        <p className="text-muted-foreground mb-4">
          {isChecking
            ? '正在检查 Star Office 后端状态...'
            : '暂时无法连接 Studio 后端，请确认 Python sidecar 已启动。'}
        </p>
        <p className="text-xs text-muted-foreground/80 mb-4">
          目标地址：{studioUrl || buildStudioBaseUrl(process.env.NEXT_PUBLIC_STUDIO_PORT)}
        </p>
        <Button onClick={() => window.location.reload()} variant="outline" size="sm">
          重新检查
        </Button>
      </motion.div>
    </div>
  )
}
