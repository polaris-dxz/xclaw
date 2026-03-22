'use client'

import { useEffect, useState } from 'react'
import { FileText, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type LogEntry = {
  id: string
  timestamp: number
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  message: string
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadLogs = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/logs?action=recent&limit=120', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '加载日志失败')
        return
      }
      setLogs(Array.isArray(data.logs) ? data.logs : [])
    } catch {
      setError('网络异常，无法加载日志')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLogs()
  }, [])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <FileText className="h-6 w-6 text-primary" />
            日志
          </h1>
          <p className="text-muted-foreground mt-1">查看系统日志和调试信息</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadLogs()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>最近日志</CardTitle>
          <CardDescription>最多显示 120 条日志记录</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无日志数据</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="border rounded-md p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{log.source}</Badge>
                    <Badge variant={log.level === 'error' ? 'destructive' : 'secondary'}>
                      {log.level}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm break-words">{log.message}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
