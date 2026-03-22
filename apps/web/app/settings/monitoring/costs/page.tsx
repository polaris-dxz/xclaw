'use client'

import { useEffect, useState } from 'react'
import { DollarSign, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function CostsPage() {
  const [summary, setSummary] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tokens?action=stats&timeframe=day', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载费用统计失败')
      setSummary(data.summary || null)
    } catch {
      setError('网络异常，无法加载费用统计')
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
            <DollarSign className="h-6 w-6 text-primary" />
            费用追踪
          </h1>
          <p className="text-muted-foreground mt-1">监控 API 调用费用和资源使用</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>近 24 小时费用</CardTitle>
          <CardDescription>来自 token usage 统计</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {loading ? <p className="text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-destructive">{error}</p> : null}
          {!loading && !error ? (
            <>
              <p>requests: {summary?.requestCount ?? 0}</p>
              <p>tokens: {summary?.totalTokens ?? 0}</p>
              <p>cost: ${Number(summary?.totalCost ?? 0).toFixed(4)}</p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
