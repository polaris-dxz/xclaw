'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function NodesPage() {
  const [nodes, setNodes] = useState<any[]>([])
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/nodes?action=list', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载节点失败')
      setNodes(Array.isArray(data.nodes) ? data.nodes : [])
      setConnected(Boolean(data.connected))
    } catch {
      setError('网络异常，无法加载节点')
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
            <Server className="h-6 w-6 text-primary" />
            节点
          </h1>
          <p className="text-muted-foreground mt-1">管理和监控计算节点状态</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>节点列表</CardTitle>
          <CardDescription>
            网关状态：{connected ? 'connected' : 'disconnected'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && nodes.length === 0 ? <p className="text-sm text-muted-foreground">暂无节点</p> : null}
          {nodes.map((node, idx) => (
            <div key={node.id || idx} className="border rounded-md p-3 flex items-center justify-between">
              <span>{node.name || node.id || `node-${idx + 1}`}</span>
              <Badge variant="outline">{node.status || 'unknown'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
