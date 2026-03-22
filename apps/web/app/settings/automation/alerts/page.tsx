'use client'

import { useEffect, useState } from 'react'
import { Bell, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AlertsPage() {
  const [rules, setRules] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/alerts', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载告警规则失败')
      setRules(Array.isArray(data.rules) ? data.rules : [])
    } catch {
      setError('网络异常，无法加载告警规则')
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
            <Bell className="h-6 w-6 text-primary" />
            告警
          </h1>
          <p className="text-muted-foreground mt-1">配置告警规则和通知设置</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>规则列表</CardTitle>
          <CardDescription>总数：{rules.length}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && rules.length === 0 ? <p className="text-sm text-muted-foreground">暂无告警规则</p> : null}
          {rules.map((rule) => (
            <div key={rule.id} className="border rounded-md p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{rule.name}</span>
                <Badge variant={rule.enabled ? 'secondary' : 'outline'}>{rule.enabled ? 'enabled' : 'disabled'}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {rule.entity_type}.{rule.condition_field} {rule.condition_operator} {rule.condition_value}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
