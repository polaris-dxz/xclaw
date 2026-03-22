'use client'

import { useEffect, useState } from 'react'
import { Building2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function OfficePage() {
  const [workload, setWorkload] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/workload', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载办公室运行态失败')
      setWorkload(data)
    } catch {
      setError('网络异常，无法加载办公室运行态')
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
            <Building2 className="h-6 w-6 text-primary" />
            办公室
          </h1>
          <p className="text-muted-foreground mt-1">办公协作和团队管理</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>工作负载信号</CardTitle>
          <CardDescription>系统容量、队列和建议动作</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && workload ? (
            <>
              <div className="flex items-center gap-2">
                <span className="text-sm">recommendation:</span>
                <Badge variant="secondary">{workload.recommendation?.action || 'normal'}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{workload.recommendation?.reason || '-'}</p>
              <p className="text-xs text-muted-foreground">
                pending: {workload.queue?.total_pending ?? 0} | online agents: {workload.agents?.online ?? 0}
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
