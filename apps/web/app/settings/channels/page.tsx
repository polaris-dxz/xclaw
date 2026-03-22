'use client'

import { useEffect, useState } from 'react'
import { Radio, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type ChannelStatus = {
  configured: boolean
  running: boolean
  connected?: boolean
  mode?: string | null
  lastError?: string | null
}

type ChannelSnapshot = {
  channels: Record<string, ChannelStatus>
  channelOrder: string[]
  channelLabels?: Record<string, string>
  connected: boolean
}

export default function ChannelsPage() {
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/channels', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '加载频道状态失败')
        return
      }
      setSnapshot(data)
    } catch {
      setError('网络异常，无法加载频道状态')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const order = snapshot?.channelOrder || Object.keys(snapshot?.channels || {})

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <Radio className="h-6 w-6 text-primary" />
            频道
          </h1>
          <p className="text-muted-foreground mt-1">配置消息频道和通知渠道</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>网关连接状态</CardTitle>
          <CardDescription>
            {snapshot?.connected ? '已连接网关' : '网关未连接'}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>频道状态</CardTitle>
          <CardDescription>各频道配置、运行和连接状态</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : order.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无频道数据</p>
          ) : (
            order.map((key) => {
              const ch = snapshot?.channels?.[key]
              if (!ch) return null
              const label = snapshot?.channelLabels?.[key] || key
              return (
                <div key={key} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{label}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant={ch.configured ? 'secondary' : 'outline'}>
                        {ch.configured ? 'configured' : 'not_configured'}
                      </Badge>
                      <Badge variant={ch.running ? 'secondary' : 'outline'}>
                        {ch.running ? 'running' : 'stopped'}
                      </Badge>
                      {typeof ch.connected === 'boolean' && (
                        <Badge variant={ch.connected ? 'secondary' : 'outline'}>
                          {ch.connected ? 'connected' : 'disconnected'}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    mode: {ch.mode || '-'}
                    {ch.lastError ? ` | error: ${ch.lastError}` : ''}
                  </p>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
