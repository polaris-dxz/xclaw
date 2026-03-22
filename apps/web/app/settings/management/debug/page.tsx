'use client'

import { useEffect, useState } from 'react'
import { Bug, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function DebugPage() {
  const [status, setStatus] = useState<any | null>(null)
  const [health, setHealth] = useState<any | null>(null)
  const [heartbeat, setHeartbeat] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, h, hb] = await Promise.all([
        fetch('/api/debug?action=status', { cache: 'no-store' }),
        fetch('/api/debug?action=health', { cache: 'no-store' }),
        fetch('/api/debug?action=heartbeat', { cache: 'no-store' }),
      ])
      const [sData, hData, hbData] = await Promise.all([s.json(), h.json(), hb.json()])
      if (!s.ok || !h.ok || !hb.ok) {
        setError(sData?.error || hData?.error || hbData?.error || '加载调试信息失败（需要管理员权限）')
        return
      }
      setStatus(sData)
      setHealth(hData)
      setHeartbeat(hbData)
    } catch {
      setError('网络异常，无法加载调试信息')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <Bug className="h-6 w-6 text-primary" />
            调试
          </h1>
          <p className="text-muted-foreground mt-1">系统调试工具和诊断</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Gateway 调试状态</CardTitle>
          <CardDescription>status / health / heartbeat</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {loading ? <p className="text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-destructive">{error}</p> : null}
          {!loading && !error ? (
            <>
              <p>reachable: {String(status?.gatewayReachable ?? true)}</p>
              <p>healthy: {String(health?.healthy ?? health?.ok ?? false)}</p>
              <p>latency_ms: {heartbeat?.latencyMs ?? '-'}</p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
