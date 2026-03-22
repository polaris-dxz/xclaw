'use client'

import { useEffect, useState } from 'react'
import { Settings, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type SettingItem = {
  key: string
  value: string
  category: string
  description: string
  is_default: boolean
}

export default function SystemSettingsPage() {
  const [settings, setSettings] = useState<SettingItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/settings', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '加载系统设置失败（需要管理员权限）')
        return
      }
      const next = Array.isArray(data.settings) ? data.settings : []
      setSettings(next)
      setDrafts(
        Object.fromEntries(
          next.map((item: SettingItem) => [item.key, item.value ?? ''])
        )
      )
    } catch {
      setError('网络异常，无法加载系统设置')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const saveOne = async (item: SettingItem) => {
    const nextValue = drafts[item.key] ?? ''
    setSavingKey(item.key)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { [item.key]: nextValue } }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '保存配置失败')
        return
      }
      setMessage(`已保存 ${item.key}`)
      await load()
    } catch {
      setError('网络异常，保存失败')
    } finally {
      setSavingKey(null)
    }
  }

  const resetOne = async (item: SettingItem) => {
    setSavingKey(item.key)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch('/api/settings', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: item.key }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.error || '重置配置失败')
        return
      }
      setMessage(`已重置 ${item.key}`)
      await load()
    } catch {
      setError('网络异常，重置失败')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <Settings className="h-6 w-6 text-primary" />
            设置
          </h1>
          <p className="text-muted-foreground mt-1">系统全局配置和偏好设置</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>配置项</CardTitle>
          <CardDescription>支持单项编辑与重置默认值</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          {loading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : settings.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无设置项</p>
          ) : (
            settings.map((item) => (
              <div key={item.key} className="border rounded-md p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{item.key}</span>
                    <Badge variant="outline">{item.category}</Badge>
                  </div>
                  <Badge variant={item.is_default ? 'outline' : 'secondary'}>
                    {item.is_default ? 'default' : 'custom'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{item.description || '无描述'}</p>
                <div className="flex items-center gap-2">
                  <Input
                    value={drafts[item.key] ?? ''}
                    onChange={(e) => setDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                    className="h-8"
                  />
                  <Button
                    size="sm"
                    onClick={() => void saveOne(item)}
                    disabled={savingKey === item.key}
                  >
                    保存
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void resetOne(item)}
                    disabled={savingKey === item.key}
                  >
                    重置
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
