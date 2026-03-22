'use client'

import { useEffect, useState } from 'react'
import { Clock, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function CronPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/cron?action=list', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载定时任务失败（需要管理员权限）')
      setJobs(Array.isArray(data.jobs) ? data.jobs : [])
    } catch {
      setError('网络异常，无法加载定时任务')
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
            <Clock className="h-6 w-6 text-primary" />
            Cron
          </h1>
          <p className="text-muted-foreground mt-1">配置和管理定时任务</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>总数：{jobs.length}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && jobs.length === 0 ? <p className="text-sm text-muted-foreground">暂无任务</p> : null}
          {jobs.map((job) => (
            <div key={job.id || job.name} className="border rounded-md p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">{job.name || job.id}</span>
                <Badge variant={job.enabled ? 'secondary' : 'outline'}>{job.enabled ? 'enabled' : 'disabled'}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{job.schedule || '-'}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
