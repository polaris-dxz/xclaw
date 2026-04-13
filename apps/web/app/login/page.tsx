'use client'

import { FormEvent, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock, LogIn } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [needsSetup, setNeedsSetup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const checkSetup = async () => {
      try {
        const res = await fetch('/api/setup', { cache: 'no-store' })
        const data = await res.json()
        setNeedsSetup(Boolean(data?.needsSetup))
      } catch {
        // Keep login usable even if setup check fails.
      }
    }
    void checkSetup()
  }, [])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await response.json()

      if (!response.ok) {
        if (data?.code === 'NO_USERS') {
          router.replace('/setup')
          return
        }
        setError(data?.hint || data?.error || '登录失败')
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

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-primary" />
            登录 xclaw
          </CardTitle>
          <CardDescription></CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <Lock className="h-4 w-4" />
              <AlertTitle>登录失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {needsSetup && (
            <Alert>
              <AlertTitle>检测到首次初始化</AlertTitle>
              <AlertDescription>
                当前还没有管理员账号，请先前往
                {' '}
                <Link href="/setup" className="underline">
                  /setup
                </Link>
                {' '}
                创建。
              </AlertDescription>
            </Alert>
          )}

          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? '登录中...' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
