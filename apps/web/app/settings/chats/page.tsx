'use client'

import { useEffect, useState } from 'react'
import { MessageSquare, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function ChatsPage() {
  const [conversations, setConversations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/conversations?limit=30', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) return setError(data?.error || '加载会话失败')
      setConversations(Array.isArray(data.conversations) ? data.conversations : [])
    } catch {
      setError('网络异常，无法加载会话')
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
            <MessageSquare className="h-6 w-6 text-primary" />
            聊天
          </h1>
          <p className="text-muted-foreground mt-1">管理对话历史和聊天设置</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>会话列表</CardTitle>
          <CardDescription>最近 30 条会话</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? <p className="text-sm text-muted-foreground">加载中...</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!loading && !error && conversations.length === 0 ? <p className="text-sm text-muted-foreground">暂无会话</p> : null}
          {conversations.map((item) => (
            <div key={item.conversation_id} className="border rounded-md p-3">
              <p className="font-medium">{item.conversation_id}</p>
              <p className="text-xs text-muted-foreground">
                messages: {item.message_count ?? 0} | participants: {item.participant_count ?? 0}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
