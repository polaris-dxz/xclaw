'use client'

import { useEffect, useState } from 'react'
import { Zap, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Skill = {
  id: string
  name: string
  source: string
  description?: string
  security_status?: string | null
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/skills', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '加载技能失败')
        return
      }
      setSkills(Array.isArray(data.skills) ? data.skills : [])
      setTotal(typeof data.total === 'number' ? data.total : 0)
    } catch {
      setError('网络异常，无法加载技能列表')
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
            <Zap className="h-6 w-6 text-primary" />
            技能广场
          </h1>
          <p className="text-muted-foreground mt-1">为您的智能体提供预封装且可重复的最佳实践与工具（与首页侧栏入口一致）</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>技能总览</CardTitle>
          <CardDescription>当前可发现技能总数：{total}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>技能列表</CardTitle>
          <CardDescription>按名称排序，展示来源与安全状态</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : skills.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无技能数据</p>
          ) : (
            skills.map((skill) => (
              <div key={skill.id} className="border rounded-md p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{skill.name}</span>
                    <Badge variant="outline">{skill.source}</Badge>
                  </div>
                  <Badge variant="secondary">{skill.security_status || 'unchecked'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{skill.description || '无描述'}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
