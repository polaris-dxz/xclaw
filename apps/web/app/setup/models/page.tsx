'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type ChatOption = { ref: string; label: string }

export default function SetupModelsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [primary, setPrimary] = useState<string>('') // empty => not configured
  const [options, setOptions] = useState<ChatOption[]>([])

  const selectable = useMemo(() => options.filter((o) => o.ref && o.ref !== 'default'), [options])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/openclaw/models', { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(String(data?.error || '无法加载模型列表'))
          return
        }
        const opts = Array.isArray(data?.chatOptions) ? (data.chatOptions as ChatOption[]) : []
        const p = typeof data?.primary === 'string' ? data.primary.trim() : ''
        if (!cancelled) {
          setOptions(opts)
          setPrimary(p)
        }
      } catch {
        if (!cancelled) setError('网络异常，无法加载模型列表')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const hasModels = selectable.length > 0

  useEffect(() => {
    if (loading) return
    if (error) return
    if (hasModels) return
    router.replace('/settings/management/models?openAdd=1&fromSetup=1')
  }, [loading, error, hasModels, router])

  const onSave = async () => {
    if (!primary) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/openclaw/models', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(String(data?.error || '保存失败'))
        return
      }
      router.replace('/')
      router.refresh()
    } catch {
      setError('网络异常，保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        正在加载模型列表...
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>选择默认模型</CardTitle>
            <CardDescription>首次进入必须选择默认模型后才能继续使用</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertTitle>无法继续</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!hasModels) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground bg-background">
        正在打开模型配置…
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>选择默认模型</CardTitle>
          <CardDescription>首次进入必须选择默认模型后才能继续使用</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Select value={primary} onValueChange={setPrimary}>
              <SelectTrigger>
                <SelectValue placeholder="请选择默认模型" />
              </SelectTrigger>
              <SelectContent>
                {selectable.map((o) => (
                  <SelectItem key={o.ref} value={o.ref}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              这是系统默认模型（持久化）。聊天输入框的模型选择只会临时覆盖当前会话，不会修改默认值。
            </p>
          </div>

          <Button className="w-full" disabled={!primary || saving} onClick={onSave}>
            {saving ? '保存中...' : '保存并进入系统'}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

