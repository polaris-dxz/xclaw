'use client'

import { useEffect, useState } from 'react'
import { Shield, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type SecurityAudit = {
  posture: { score: number; level: string }
  authEvents?: { loginFailures: number; tokenRotations: number; accessDenials: number }
  secretExposures?: { total: number }
  rateLimits?: { totalHits: number }
}

export default function SecurityPage() {
  const [audit, setAudit] = useState<SecurityAudit | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/security-audit?timeframe=day', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '加载安全审计失败（需要管理员权限）')
        return
      }
      setAudit(data)
    } catch {
      setError('网络异常，无法加载安全审计数据')
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
            <Shield className="h-6 w-6 text-primary" />
            安全
          </h1>
          <p className="text-muted-foreground mt-1">配置安全策略和访问控制</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>安全态势</CardTitle>
          <CardDescription>基于最近 24 小时数据计算</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !audit ? (
            <p className="text-sm text-muted-foreground">暂无安全数据</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl font-semibold">{audit.posture?.score ?? 0}</span>
                <Badge variant="secondary">{audit.posture?.level || 'unknown'}</Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="border rounded-md p-3">
                  <div className="text-muted-foreground">登录失败</div>
                  <div className="text-lg font-medium">{audit.authEvents?.loginFailures ?? 0}</div>
                </div>
                <div className="border rounded-md p-3">
                  <div className="text-muted-foreground">令牌轮换</div>
                  <div className="text-lg font-medium">{audit.authEvents?.tokenRotations ?? 0}</div>
                </div>
                <div className="border rounded-md p-3">
                  <div className="text-muted-foreground">访问拒绝</div>
                  <div className="text-lg font-medium">{audit.authEvents?.accessDenials ?? 0}</div>
                </div>
                <div className="border rounded-md p-3">
                  <div className="text-muted-foreground">密钥暴露</div>
                  <div className="text-lg font-medium">{audit.secretExposures?.total ?? 0}</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                最近限流命中：{audit.rateLimits?.totalHits ?? 0}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
