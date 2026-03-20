'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, Loader2 } from 'lucide-react'
import { buildStudioBaseUrl, buildStudioEmbedUrl, buildStudioHealthUrl } from '@/lib/studio/runtime'
import { Button } from '@/components/ui/button'

export function StudioPanel() {
  const [studioUrl, setStudioUrl] = useState<string>('')
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

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
        const response = await fetch(buildStudioHealthUrl(baseUrl), {
          cache: 'no-store',
          mode: 'no-cors',
        })
        if (!cancelled) {
          // no-cors 响应在浏览器中通常是 opaque，无法读取 ok；能完成请求就先视为 online。
          setStatus('online')
        }
      } catch {
        if (!cancelled) {
          setStatus('offline')
        }
      }

      timer = setTimeout(checkHealth, 5000)
    }

    void checkHealth()

    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [])

  if (studioUrl) {
    return (
      <div className="relative flex-1 h-full min-h-0 overflow-hidden">
        <iframe
          title="Star Office Studio"
          src={buildStudioEmbedUrl(studioUrl)}
          className="block h-full min-h-0 w-full border-0"
        />
        <div className="absolute top-3 right-3 z-10 rounded-md bg-background/80 backdrop-blur px-2 py-1 text-xs border border-border/60">
          {status === 'offline' ? '后端连接失败，已直接加载页面' : status === 'checking' ? '检查连接中...' : 'Studio 在线'}
        </div>
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
