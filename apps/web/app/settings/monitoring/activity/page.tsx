'use client'

import { useEffect, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type ActivityItem = {
  id: number
  type: string
  actor: string
  description: string
  created_at: number
}

export default function ActivityPage() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadActivities = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/activities?limit=40', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '加载活动失败')
        return
      }
      setActivities(Array.isArray(data.activities) ? data.activities : [])
    } catch {
      setError('网络异常，无法加载活动数据')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadActivities()
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <Activity className="h-6 w-6 text-primary" />
            活动
          </h1>
          <p className="text-muted-foreground mt-1">查看系统活动和事件记录</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadActivities()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>实时活动流</CardTitle>
          <CardDescription>显示最近 40 条系统事件</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无活动记录</p>
          ) : (
            activities.map((item) => (
              <div key={item.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{item.type}</Badge>
                    <span className="text-sm font-medium">{item.actor}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.created_at * 1000).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-foreground">{item.description}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
