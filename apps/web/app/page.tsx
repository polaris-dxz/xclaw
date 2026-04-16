'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { AppHeader } from '@/components/layout/app-header'
import { ChatSidebar } from '@/components/chat/chat-sidebar'
import { ChatPanel } from '@/components/chat/chat-panel'
import { StudioPanel } from '@/components/studio/studio-panel'
import { useXClawStore } from '@/store'
import { useServerEvents } from '@/lib/use-server-events'
import { useWebSocket } from '@/lib/websocket'
import { cn } from '@/lib/utils'
import { createPendingConversation } from '@/lib/pending-conversation'
import { useModelSetupGate } from '@/lib/use-model-setup-gate'

/** 与嵌入的 Star 像素办公室页面 body 背景一致（studio-api apps/web/index.html） */
const STUDIO_CHROME_BG = '#1a1a2e'

function isBootFetchAbort(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

export default function Home() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'chat' | 'studio'>('chat')
  const [bootChecking, setBootChecking] = useState(true)
  const [desktopTopInset, setDesktopTopInset] = useState(0)
  const { setConversations, setActiveConversation } = useXClawStore()
  const { connect } = useWebSocket()
  useServerEvents()
  useModelSetupGate()

  const tabs = [
    { id: 'chat', label: '对话' },
    { id: 'studio', label: '工作室' },
  ] as const

  useEffect(() => {
    const electronApi = (window as Window & { electronAPI?: { platform?: string } }).electronAPI
    if (electronApi?.platform === 'darwin') {
      setDesktopTopInset(40)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const fetchWithTimeout = async (url: string, timeoutMs = 8000) => {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort(
          new DOMException(`Boot fetch exceeded ${timeoutMs}ms: ${url}`, 'TimeoutError'),
        )
      }, timeoutMs)
      try {
        return await fetch(url, { cache: 'no-store', signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
    }

    const checkAccess = async () => {
      try {
        const setupRes = await fetchWithTimeout('/api/setup')
        const setupData = await setupRes.json().catch(() => null)
        if (!cancelled && setupData?.needsSetup) {
          router.replace('/setup')
          return
        }

        const authRes = await fetchWithTimeout('/api/auth/me')
        if (!cancelled && authRes.status === 401) {
          router.replace('/login?next=%2F')
          return
        }

        const resolveGatewayConnectTarget = async (): Promise<{ wsUrl: string; token?: string } | null> => {
          try {
            const gatewaysRes = await fetchWithTimeout('/api/gateways')
            if (!gatewaysRes.ok) return null
            const gatewaysData = await gatewaysRes.json().catch(() => ({}))
            const gateways = Array.isArray(gatewaysData?.gateways) ? gatewaysData.gateways : []
            const primary = gateways.find((item: any) => Number(item?.is_primary) === 1) || gateways[0]
            if (!primary?.id) return null

            const controller = new AbortController()
            const timer = setTimeout(() => {
              controller.abort(
                new DOMException('Boot fetch exceeded 8000ms: /api/gateways/connect', 'TimeoutError'),
              )
            }, 8000)
            const connectRes = await fetch('/api/gateways/connect', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              signal: controller.signal,
              body: JSON.stringify({ id: Number(primary.id) }),
            }).finally(() => clearTimeout(timer))
            if (!connectRes.ok) return null
            const connectData = await connectRes.json().catch(() => ({}))
            if (!connectData?.ws_url) return null
            return {
              wsUrl: String(connectData.ws_url),
              token: connectData?.token ? String(connectData.token) : undefined,
            }
          } catch {
            return null
          }
        }

        const gatewayTarget = await resolveGatewayConnectTarget()
        if (!cancelled && gatewayTarget?.wsUrl) {
          connect(gatewayTarget.wsUrl, gatewayTarget.token)
          return
        }

        const wsUrlFallback = process.env.NEXT_PUBLIC_GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_HOST || ''
        if (!cancelled && wsUrlFallback) {
          connect(wsUrlFallback)
        }
      } catch (error) {
        if (isBootFetchAbort(error)) {
          // 超时取消：避免 console.error 触发 Next 开发环境全屏 AbortError overlay
          if (process.env.NODE_ENV === 'development') {
            console.debug('[boot] request timed out; UI continues', error)
          }
        } else {
          console.error('Boot check failed', error)
        }
      } finally {
        if (!cancelled) setBootChecking(false)
      }
    }

    void checkAccess()
    return () => {
      cancelled = true
    }
  }, [router])
  
  const handleNewChat = () => {
    setActiveTab('chat')
    const fresh = createPendingConversation()
    const prev = useXClawStore.getState().conversations
    setConversations([fresh, ...prev])
    setActiveConversation(fresh.id)
  }
  
  if (bootChecking) {
    return <div className="h-screen flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
  }

  const studioShell = activeTab === 'studio'

  return (
    <div
      className={cn(
        'h-screen flex flex-col overflow-hidden',
        studioShell ? 'text-slate-100' : 'bg-background',
      )}
      style={{
        paddingTop: desktopTopInset,
        ...(studioShell ? { backgroundColor: STUDIO_CHROME_BG } : {}),
      }}
    >
      <AppHeader
        tabs={[...tabs]}
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab as 'chat' | 'studio')}
        onNewChat={handleNewChat}
        variant={studioShell ? 'studio' : 'default'}
      />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-hidden">
        <ChatSidebar
          onNavigateToChat={() => setActiveTab('chat')}
          studioShell={studioShell}
        />

        <AnimatePresence mode="wait">
          {activeTab === 'chat' ? (
            <motion.div
              key="chat"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
              className="flex flex-1 min-h-0 min-w-0"
            >
              <ChatPanel />
            </motion.div>
          ) : (
            <motion.div
              key="studio"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.2 }}
              className="flex flex-1 min-h-0 min-w-0"
              style={{ backgroundColor: STUDIO_CHROME_BG }}
            >
              <StudioPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
