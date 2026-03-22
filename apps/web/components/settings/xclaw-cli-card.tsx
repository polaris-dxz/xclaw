'use client'

import { useCallback, useEffect, useState } from 'react'
import { Terminal } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

type XclawCliApi = {
  xclawCliGetStatus: () => Promise<XclawCliStatus>
  xclawCliInstall: () => Promise<XclawCliInstallResult>
  xclawCliUninstall: () => Promise<XclawCliUninstallResult>
}

type XclawCliStatus =
  | { ok: false; error: string }
  | {
      ok: true
      platform?: string
      installed?: boolean
      targetPath?: string
      homeBin?: string
      homeBinOnPath?: boolean
      binDir?: string
      binDirOnPath?: boolean
    }

type XclawCliInstallResult = {
  ok: boolean
  error?: string
  alreadyInstalled?: boolean
  targetPath?: string
  homeBinOnPath?: boolean
  binDirOnPath?: boolean
}

type XclawCliUninstallResult = {
  ok: boolean
  error?: string
  alreadyRemoved?: boolean
}

function getElectronXclawApi(): XclawCliApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as Window & { electronAPI?: XclawCliApi }).electronAPI
  if (!api?.xclawCliGetStatus || !api?.xclawCliInstall || !api?.xclawCliUninstall) return null
  return api
}

export function XclawCliCard() {
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState<XclawCliStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    const api = getElectronXclawApi()
    if (!api) {
      setVisible(false)
      return
    }
    setVisible(true)
    try {
      const s = await api.xclawCliGetStatus()
      setStatus(s)
    } catch {
      setStatus({ ok: false, error: '无法读取状态' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!visible) return null

  const installed = status && 'ok' in status && status.ok && status.installed
  const isWin =
    typeof window !== 'undefined' &&
    (window as Window & { electronAPI?: { platform?: string } }).electronAPI?.platform === 'win32'

  const onInstall = async () => {
    const api = getElectronXclawApi()
    if (!api) return
    setBusy(true)
    setToast(null)
    try {
      const r: XclawCliInstallResult = await api.xclawCliInstall()
      if (!r.ok) {
        setToast(r.error === 'bundle_missing' ? '未找到内置脚本，请重新安装应用' : `安装失败：${r.error || ''}`)
        await load()
        return
      }
      if (r.alreadyInstalled) {
        setToast(`已安装：${r.targetPath || ''}`)
      } else if (isWin || r.binDirOnPath) {
        setToast(
          isWin
            ? `已安装到 ${r.targetPath}。请重新打开终端后运行 xclaw`
            : `已安装到 ${r.targetPath}。可在终端运行 xclaw`,
        )
      } else {
        setToast(`已安装到 ${r.targetPath}。若终端找不到命令，请将 ~/bin 加入 PATH`)
      }
      await load()
    } catch {
      setToast('安装失败')
    } finally {
      setBusy(false)
    }
  }

  const onUninstall = async () => {
    const api = getElectronXclawApi()
    if (!api) return
    setBusy(true)
    setToast(null)
    try {
      const r: XclawCliUninstallResult = await api.xclawCliUninstall()
      if (!r.ok) {
        setToast(r.error === 'not_our_symlink' ? '目标不是由 xclaw 创建的链接，未删除' : `卸载失败：${r.error || ''}`)
        await load()
        return
      }
      setToast('已卸载命令行入口')
      await load()
    } catch {
      setToast('卸载失败')
    } finally {
      setBusy(false)
    }
  }

  const pathHint =
    status && 'ok' in status && status.ok
      ? isWin
        ? status.targetPath
          ? `${status.targetPath}${status.binDirOnPath === false ? '（请新开终端后再试 xclaw）' : ''}`
          : ''
        : status.targetPath
          ? `${status.targetPath}${status.homeBinOnPath === false ? ' · 若找不到命令请将 ~/bin 加入 PATH' : ''}`
          : ''
      : ''

  return (
    <div className="grid grid-cols-1 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            命令行工具 xclaw
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            将内置 OpenClaw CLI 以 <code className="text-xs bg-muted px-1 rounded">xclaw</code> 装入
            PATH，与系统可能存在的 <code className="text-xs bg-muted px-1 rounded">openclaw</code>{' '}
            区分。需先由本应用生成 <code className="text-xs bg-muted px-1 rounded">~/.xclaw/xclaw.json</code>。
          </p>
          {status && !status.ok ? (
            <p className="text-destructive">{status.error === 'bundle_missing' ? '未找到内置脚本' : status.error}</p>
          ) : null}
          {status && status.ok ? (
            <div className="flex flex-wrap gap-2 items-center">
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded ${installed ? 'bg-green-500/15 text-green-600' : 'bg-muted text-muted-foreground'}`}
              >
                {installed ? '已安装' : '未安装'}
              </span>
              {pathHint ? <span className="text-xs text-muted-foreground break-all">{pathHint}</span> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void onInstall()} disabled={busy}>
              安装到 PATH
            </Button>
            <Button size="sm" variant="outline" onClick={() => void onUninstall()} disabled={busy || !installed}>
              卸载
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
              刷新状态
            </Button>
          </div>
          {toast ? <p className="text-xs text-muted-foreground">{toast}</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
