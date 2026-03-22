'use client'

import { useEffect, useState } from 'react'
import { Github, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function GithubPage() {
  const [stats, setStats] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/github?action=stats', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载 GitHub 状态失败')
      setStats(data)
    } catch {
      setError('网络异常，无法加载 GitHub 状态')
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
            <Github className="h-6 w-6 text-primary" />
            GitHub
          </h1>
          <p className="text-muted-foreground mt-1">配置 GitHub 集成和自动化</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>账号与仓库概览</CardTitle>
          <CardDescription>来自 `/api/github?action=stats`</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && !stats ? <p className="text-sm text-muted-foreground">暂无数据</p> : null}
          {stats ? (
            <div className="text-sm space-y-1">
              <p>user: {stats.user?.login || '-'}</p>
              <p>repos: {stats.repos?.total ?? 0}</p>
              <p>stars: {stats.repos?.total_stars ?? 0}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
