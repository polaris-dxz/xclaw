'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Webhook } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function WebhooksPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/webhooks', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载 Webhooks 失败（需要管理员权限）')
      setItems(Array.isArray(data.webhooks) ? data.webhooks : [])
    } catch {
      setError('网络异常，无法加载 Webhooks')
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
            <Webhook className="h-6 w-6 text-primary" />
            Webhooks
          </h1>
          <p className="text-muted-foreground mt-1">配置 Webhook 触发器和回调</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Webhook 列表</CardTitle>
          <CardDescription>总数：{items.length}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && items.length === 0 ? <p className="text-sm text-muted-foreground">暂无 Webhook</p> : null}
          {items.map((w) => (
            <div key={w.id} className="border rounded-md p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">{w.name || `Webhook #${w.id}`}</span>
                <Badge variant={w.enabled ? 'secondary' : 'outline'}>{w.enabled ? 'enabled' : 'disabled'}</Badge>
              </div>
              <p className="text-xs text-muted-foreground break-all">{w.url || '-'}</p>
              <p className="text-xs text-muted-foreground">
                success: {w.successful_deliveries ?? 0} / total: {w.total_deliveries ?? 0} / failed: {w.failed_deliveries ?? 0}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
