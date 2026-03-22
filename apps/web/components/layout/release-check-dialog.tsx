'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { APP_VERSION } from '@/lib/version'
import {
  DISMISSED_RELEASE_KEY,
  fetchReleaseCheck,
  getElectronUpdaterApi,
  type ReleaseCheckPayload,
} from '@/lib/release-check-client'

export function ReleaseCheckDialog({
  open,
  onOpenChange,
  onAfterCheck,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 检查完成或忽略更新后回调（用于刷新顶栏红点等） */
  onAfterCheck?: () => void
}) {
  const [dialogCheck, setDialogCheck] = useState<ReleaseCheckPayload | null>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogError, setDialogError] = useState(false)
  const onAfterCheckRef = useRef(onAfterCheck)
  onAfterCheckRef.current = onAfterCheck

  useEffect(() => {
    if (!open) return
    setDialogLoading(true)
    setDialogError(false)
    setDialogCheck(null)
    let cancelled = false
    void fetchReleaseCheck()
      .then((data) => {
        if (!cancelled) {
          setDialogCheck(data)
          onAfterCheckRef.current?.()
        }
      })
      .catch(() => {
        if (!cancelled) setDialogError(true)
      })
      .finally(() => {
        if (!cancelled) setDialogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const dismissUpdateBadge = () => {
    if (dialogCheck?.latestVersion && !dialogCheck.readyToInstall) {
      try {
        window.localStorage.setItem(DISMISSED_RELEASE_KEY, dialogCheck.latestVersion)
      } catch {
        /* ignore */
      }
      onAfterCheckRef.current?.()
    }
    onOpenChange(false)
  }

  const showRestartInstall = dialogCheck?.readyToInstall === true
  const upToDate = dialogCheck && !dialogCheck.updateAvailable && !dialogCheck.readyToInstall
  const hasUpdate = dialogCheck?.updateAvailable === true && !dialogCheck.readyToInstall

  const quitAndInstall = async () => {
    const api = getElectronUpdaterApi()
    await api?.updaterQuitAndInstall?.()
  }

  const retry = () => {
    setDialogLoading(true)
    setDialogError(false)
    setDialogCheck(null)
    void fetchReleaseCheck()
      .then((data) => {
        setDialogCheck(data)
        onAfterCheckRef.current?.()
      })
      .catch(() => setDialogError(true))
      .finally(() => setDialogLoading(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="gap-6 rounded-2xl border-none p-8 text-center shadow-xl sm:max-w-md">
        {dialogLoading ? (
          <>
            <DialogHeader className="sr-only">
              <DialogTitle>检查更新</DialogTitle>
            </DialogHeader>
            <p className="text-muted-foreground text-sm">正在检查更新…</p>
          </>
        ) : dialogError ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-center text-base">无法检查更新</DialogTitle>
              <DialogDescription className="text-center">请确认网络可用后重试。</DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-center">
              <Button type="button" className="rounded-full px-8" onClick={() => void retry()}>
                重试
              </Button>
            </DialogFooter>
          </>
        ) : showRestartInstall ? (
          <>
            <DialogHeader className="gap-2 sm:text-center">
              <DialogTitle className="text-center text-lg font-semibold">已准备好安装</DialogTitle>
              <DialogDescription className="text-center text-base">
                新版本 v{dialogCheck?.latestVersion} 已下载，重启应用后将完成更新。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button
                type="button"
                className="rounded-full bg-foreground px-10 text-background hover:bg-foreground/90"
                onClick={() => void quitAndInstall()}
              >
                重启并更新
              </Button>
              <Button type="button" className="rounded-full px-8" variant="outline" onClick={() => onOpenChange(false)}>
                稍后
              </Button>
            </DialogFooter>
          </>
        ) : upToDate ? (
          <>
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <CheckCircle2 className="h-4 w-4 text-foreground" strokeWidth={2.5} />
              </div>
              <DialogHeader className="gap-2 sm:text-center">
                <DialogTitle className="text-center text-lg font-semibold">已是最新版本</DialogTitle>
                <DialogDescription className="text-center text-base">
                  当前版本 v{dialogCheck?.currentVersion ?? APP_VERSION}，无需更新。
                </DialogDescription>
              </DialogHeader>
            </div>
            <DialogFooter className="sm:justify-center">
              <Button
                type="button"
                className="rounded-full bg-foreground px-10 text-background hover:bg-foreground/90"
                onClick={() => onOpenChange(false)}
              >
                知道了
              </Button>
            </DialogFooter>
          </>
        ) : hasUpdate ? (
          <>
            <DialogHeader className="gap-2 sm:text-center">
              <DialogTitle className="text-center text-lg font-semibold">发现新版本</DialogTitle>
              <DialogDescription className="text-center text-base">
                最新版本 v{dialogCheck?.latestVersion}，当前版本 v{dialogCheck?.currentVersion ?? APP_VERSION}
                。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              {dialogCheck?.releaseUrl ? (
                <Button type="button" className="rounded-full px-8" variant="secondary" asChild>
                  <a href={dialogCheck.releaseUrl} target="_blank" rel="noopener noreferrer">
                    查看发布页
                  </a>
                </Button>
              ) : null}
              <Button
                type="button"
                className="rounded-full bg-foreground px-10 text-background hover:bg-foreground/90"
                onClick={dismissUpdateBadge}
              >
                知道了
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
