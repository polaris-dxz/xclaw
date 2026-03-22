'use client'

import { useEffect, useState } from 'react'
import { FileSearch, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type AuditEvent = {
  id: number
  action: string
  actor: string
  target_type?: string | null
  target_id?: number | null
  created_at: number
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadEvents = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/audit?limit=200', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '加载审计日志失败（需要管理员权限）')
        return
      }
      setEvents(Array.isArray(data.events) ? data.events : [])
    } catch {
      setError('网络异常，无法加载审计日志')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadEvents()
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <FileSearch className="h-6 w-6 text-primary" />
            审计
          </h1>
          <p className="text-muted-foreground mt-1">查看操作审计日志和记录</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadEvents()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>审计事件</CardTitle>
          <CardDescription>最近 200 条事件，按时间倒序</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无审计事件</p>
          ) : (
            events.map((event) => (
              <div key={event.id} className="border rounded-md p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{event.action}</Badge>
                    <span className="text-sm">{event.actor}</span>
                    {event.target_type && (
                      <span className="text-xs text-muted-foreground">
                        {event.target_type}
                        {event.target_id ? `#${event.target_id}` : ''}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.created_at * 1000).toLocaleString()}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
