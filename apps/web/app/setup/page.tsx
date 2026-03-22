'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SetupPage() {
  const router = useRouter()
  const [username, setUsername] = useState('admin')
  const [displayName, setDisplayName] = useState('Administrator')
  const [password, setPassword] = useState('')
  const [checking, setChecking] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const checkNeedsSetup = async () => {
      try {
        const response = await fetch('/api/setup', { cache: 'no-store' })
        const data = await response.json()
        // Keep setup page reachable even when backend state changes,
        // so users can understand the current status instead of being bounced.
        if (!data?.needsSetup) {
          setError('初始化已完成。如需重新创建管理员，请先清理用户数据后再访问本页。')
        }
      } catch {
        setError('无法检查初始化状态，请刷新后重试')
      } finally {
        setChecking(false)
      }
    }
    void checkNeedsSetup()
  }, [router])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, displayName }),
      })
      const data = await response.json()

      if (!response.ok) {
        setError(data?.error || '初始化失败')
        return
      }

      router.replace('/')
      router.refresh()
    } catch {
      setError('网络异常，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        正在检查初始化状态...
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            初始化管理员账号
          </CardTitle>
          <CardDescription>仅首次启动需要执行此步骤</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>初始化失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">显示名</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码（至少 12 位）</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={12}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '创建中...' : '创建管理员并进入系统'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
