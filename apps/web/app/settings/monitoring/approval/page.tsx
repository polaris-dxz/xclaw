'use client'

import { useEffect, useState } from 'react'
import { ClipboardCheck, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ApprovalPage() {
  const [approvals, setApprovals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/exec-approvals', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载审批队列失败')
      setApprovals(Array.isArray(data.approvals) ? data.approvals : [])
    } catch {
      setError('网络异常，无法加载审批队列')
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
            <ClipboardCheck className="h-6 w-6 text-primary" />
            审批
          </h1>
          <p className="text-muted-foreground mt-1">处理待审批的请求和任务</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>待审批请求</CardTitle>
          <CardDescription>当前数量：{approvals.length}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && approvals.length === 0 ? <p className="text-sm text-muted-foreground">暂无待审批请求</p> : null}
          {approvals.map((item, idx) => (
            <div key={item.id || idx} className="border rounded-md p-3 flex items-center justify-between">
              <span className="text-sm truncate">{item.command || item.id || 'approval-request'}</span>
              <Badge variant="outline">{item.action || 'pending'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
