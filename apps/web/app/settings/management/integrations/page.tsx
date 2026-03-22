'use client'

import { useEffect, useState } from 'react'
import { Puzzle, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Integration = {
  id: string
  name: string
  categoryLabel: string
  status: 'connected' | 'partial' | 'not_configured'
  envVars: Record<string, { redacted: string; set: boolean }>
}

export default function IntegrationsPage() {
  const [items, setItems] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/integrations', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '加载集成失败（需要管理员权限）')
        return
      }
      setItems(Array.isArray(data.integrations) ? data.integrations : [])
    } catch {
      setError('网络异常，无法加载集成信息')
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
            <Puzzle className="h-6 w-6 text-primary" />
            集成
          </h1>
          <p className="text-muted-foreground mt-1">管理第三方服务集成</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>集成状态</CardTitle>
          <CardDescription>已配置的连接项会显示脱敏后的凭据尾号</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无集成数据</p>
          ) : (
            items.map((it) => (
              <div key={it.id} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{it.name}</span>
                    <Badge variant="outline">{it.categoryLabel}</Badge>
                  </div>
                  <Badge variant={it.status === 'connected' ? 'secondary' : 'outline'}>
                    {it.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  {Object.entries(it.envVars || {}).map(([key, v]) => (
                    <div key={key}>
                      {key}: {v.set ? v.redacted || '已设置' : '未设置'}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
