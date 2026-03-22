'use client'

import { useEffect, useState } from 'react'
import { Monitor, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function MonitorPage() {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/system-monitor', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) return setError(json?.error || '加载系统监控失败')
      setData(json)
    } catch {
      setError('网络异常，无法加载系统监控')
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
            <Monitor className="h-6 w-6 text-primary" />
            Monitor
          </h1>
          <p className="text-muted-foreground mt-1">实时监控系统性能和健康状态</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>系统快照</CardTitle>
          <CardDescription>CPU / Memory / Processes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {loading ? <p className="text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-destructive">{error}</p> : null}
          {data ? (
            <>
              <p>cpu: {data.cpu?.usagePercent ?? 0}%</p>
              <p>memory: {data.memory?.usagePercent ?? 0}%</p>
              <p>processes: {(data.processes || []).length}</p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
