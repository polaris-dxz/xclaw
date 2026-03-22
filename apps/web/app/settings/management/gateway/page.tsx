'use client'

import { useEffect, useState } from 'react'
import { Network, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Gateway = {
  id: number
  name: string
  host: string
  port: number
  status: string
  is_primary: number
  sessions_count: number
  agents_count: number
}

export default function GatewayPage() {
  const [gateways, setGateways] = useState<Gateway[]>([])
  const [configPath, setConfigPath] = useState<string>('-')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [gwRes, cfgRes] = await Promise.all([
        fetch('/api/gateways', { cache: 'no-store' }),
        fetch('/api/gateway-config', { cache: 'no-store' }),
      ])

      const gwData = await gwRes.json()
      if (!gwRes.ok) {
        setError(gwData?.error || '加载网关列表失败')
      } else {
        setGateways(Array.isArray(gwData.gateways) ? gwData.gateways : [])
      }

      const cfgData = await cfgRes.json()
      if (cfgRes.ok) setConfigPath(cfgData.path || '-')
    } catch {
      setError('网络异常，无法加载网关数据')
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
            <Network className="h-6 w-6 text-primary" />
            网关
          </h1>
          <p className="text-muted-foreground mt-1">配置 API 网关和路由规则</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>网关配置</CardTitle>
          <CardDescription>当前配置文件路径：{configPath}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>网关列表</CardTitle>
          <CardDescription>显示已注册网关及其实时状态</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : gateways.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无网关数据</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>地址</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>主网关</TableHead>
                  <TableHead>会话数</TableHead>
                  <TableHead>智能体数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gateways.map((gw) => (
                  <TableRow key={gw.id}>
                    <TableCell>{gw.name}</TableCell>
                    <TableCell>{gw.host}:{gw.port}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{gw.status}</Badge>
                    </TableCell>
                    <TableCell>{gw.is_primary ? '是' : '否'}</TableCell>
                    <TableCell>{gw.sessions_count}</TableCell>
                    <TableCell>{gw.agents_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
