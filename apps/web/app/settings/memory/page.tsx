'use client'

import { useEffect, useState } from 'react'
import { Brain, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function MemoryPage() {
  const [tree, setTree] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/memory?action=tree&depth=2', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载记忆树失败')
      setTree(Array.isArray(data.tree) ? data.tree : [])
    } catch {
      setError('网络异常，无法加载记忆树')
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
            <Brain className="h-6 w-6 text-primary" />
            记忆
          </h1>
          <p className="text-muted-foreground mt-1">管理 AI 的长期记忆和上下文</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>记忆文件树</CardTitle>
          <CardDescription>根节点数：{tree.length}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && tree.length === 0 ? <p className="text-sm text-muted-foreground">暂无记忆文件</p> : null}
          {tree.slice(0, 20).map((node) => (
            <div key={node.path} className="border rounded-md p-3 flex items-center justify-between">
              <span className="text-sm">{node.path || node.name}</span>
              <Badge variant="outline">{node.type || 'unknown'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
