'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  X,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { REMOTE_CHANNEL_LABELS, type RemoteChannelBindPlatform } from '@/lib/remote-channel-labels'

export const REMOTE_CHANNEL_GUIDES = {
  /** 个人微信 openclaw-weixin（扫码登录） */
  weixin: 'https://qclaw.qq.com/docs/205521954835513344.html',
  /** 微信客服号 / 腾讯通路 — 配置说明（与扫码落地页可不同） */
  wechat_access: 'https://qclaw.qq.com/docs/205521954835513344.html',
  wecom: 'https://qclaw.qq.com/docs/205610395614810112.html',
  qq: 'https://qclaw.qq.com/docs/205615522432028672.html',
  feishu: 'https://qclaw.qq.com/docs/205616560371372032.html',
  dingtalk: 'https://qclaw.qq.com/docs/205617939969196032.html',
} as const

type PlatformId = 'weixin' | 'wechat_access' | 'wecom' | 'qq' | 'feishu' | 'dingtalk'

type ChannelSnapshot = {
  channels?: Record<string, { configured?: boolean }>
}

const PLATFORMS: {
  id: PlatformId
  name: string
  description: string
  recommended?: boolean
  channelKey: string
  guideUrl: string
  logoClass: string
}[] = [
  {
    id: 'weixin',
    name: '微信',
    description:
      '个人微信通道（扫码登录）。在终端执行文档中的登录命令完成扫码后，可在微信内与 xclaw 对话。',
    recommended: true,
    channelKey: 'weixin',
    guideUrl: REMOTE_CHANNEL_GUIDES.weixin,
    logoClass: 'bg-[#07C160]',
  },
  // --- 暂时隐藏：微信客服号（腾讯通路 wechat-access）；恢复时取消下方块注释 ---
  // {
  //   id: 'wechat_access',
  //   name: '微信客服号',
  //   description:
  //     '腾讯通路 / 微信客服：在文档中完成开通后，将 Token 填入本页保存；凭据仅保存在本机。',
  //   recommended: true,
  //   channelKey: 'wechat-access',
  //   guideUrl: REMOTE_CHANNEL_GUIDES.wechat_access,
  //   logoClass: 'bg-[#07C160]',
  // },
  {
    id: 'wecom',
    name: '企业微信',
    description:
      '在企业微信后台创建机器人，填写 Bot ID 与 Secret 保存；凭据仅保存在本机。',
    recommended: true,
    channelKey: 'wecom',
    guideUrl: REMOTE_CHANNEL_GUIDES.wecom,
    logoClass: 'bg-[#2B6CEE]',
  },
  {
    id: 'qq',
    name: 'QQ',
    description: '极简配置流程，快速将 xclaw 接入 QQ 中，后续可在 QQ 内与 xclaw 方便对话交互。',
    recommended: true,
    channelKey: 'qqbot',
    guideUrl: REMOTE_CHANNEL_GUIDES.qq,
    logoClass: 'bg-[#12B7F5]',
  },
  {
    id: 'feishu',
    name: '飞书',
    description: '将 xclaw 接入飞书机器人，团队成员在飞书群聊或私聊中即可直接对话 xclaw，无缝衔接办公流程。',
    channelKey: 'feishu',
    guideUrl: REMOTE_CHANNEL_GUIDES.feishu,
    logoClass: 'bg-[#3370FF]',
  },
  {
    id: 'dingtalk',
    name: '钉钉',
    description: '将 xclaw 接入钉钉机器人，团队成员可在钉钉群聊或私聊中直接与 xclaw 交互，高效处理工作指令。',
    channelKey: 'dingtalk-connector',
    guideUrl: REMOTE_CHANNEL_GUIDES.dingtalk,
    logoClass: 'bg-[#0089FF]',
  },
]

function GuideLinkButton({ href }: { href: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-full h-8 gap-1 text-xs shrink-0"
      onClick={() => window.open(href, '_blank', 'noopener,noreferrer')}
    >
      查看配置指南
      <ArrowUpRight className="h-3.5 w-3.5" />
    </Button>
  )
}

function SecretInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10 rounded-xl"
        autoComplete="off"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? '隐藏' : '显示'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

export function RemoteChannelSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [snapshot, setSnapshot] = useState<ChannelSnapshot | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [active, setActive] = useState<PlatformId | null>(null)

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const res = await fetch('/api/channels', { cache: 'no-store', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) {
        setSnapshot(null)
        return
      }
      setSnapshot(data as ChannelSnapshot)
    } catch {
      setSnapshot(null)
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadStatus()
  }, [open, loadStatus])

  const configuredMap = useMemo(() => {
    const m: Record<string, boolean> = {}
    for (const p of PLATFORMS) {
      m[p.id] = !!snapshot?.channels?.[p.channelKey]?.configured
    }
    return m
  }, [snapshot])

  const activeMeta = PLATFORMS.find((p) => p.id === active) ?? null

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden">
          <SheetHeader className="px-6 pt-6 pb-2 text-left space-y-2 border-b border-border/50">
            <SheetTitle className="text-base font-medium text-muted-foreground">
              接入远控通道，用户可以直接在聊天工具中与 xclaw 对话交互
            </SheetTitle>
            <SheetDescription className="sr-only">配置 QQ、微信、企业微信、飞书、钉钉等远控通道</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 py-5 bg-muted/30">
            {loadingStatus ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载通道状态…
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {PLATFORMS.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm flex flex-col gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'h-11 w-11 rounded-xl shrink-0 flex items-center justify-center text-white text-xs font-bold',
                          p.logoClass,
                        )}
                      >
                        {p.name.slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-foreground">{p.name}</span>
                          {p.recommended ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-0 text-[10px] px-1.5 py-0">
                              推荐
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{p.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 mt-auto pt-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      {configuredMap[p.id] ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-full px-5"
                          onClick={() => setActive(p.id)}
                        >
                          已配置
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="rounded-full px-5 bg-foreground text-background hover:bg-foreground/90"
                          onClick={() => setActive(p.id)}
                        >
                          配置
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={active !== null} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-md rounded-2xl p-0 gap-0 overflow-hidden"
        >
          {activeMeta && (
            <PlatformConfigDialogBody
              dialogOpen={active !== null}
              meta={activeMeta}
              isConfigured={active ? !!configuredMap[active] : false}
              onClose={() => setActive(null)}
              onSuccess={() => {
                void loadStatus()
                setActive(null)
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function isRemoteBindPlatform(id: PlatformId): id is RemoteChannelBindPlatform {
  return (
    id === 'qq' ||
    id === 'wecom' ||
    id === 'feishu' ||
    id === 'dingtalk' ||
    id === 'weixin' ||
    id === 'wechat_access'
  )
}

function PlatformConfigDialogBody({
  dialogOpen,
  meta,
  isConfigured,
  onClose,
  onSuccess,
}: {
  dialogOpen: boolean
  meta: (typeof PLATFORMS)[number]
  isConfigured: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [submitting, setSubmitting] = useState(false)

  const [qrImageSrc, setQrImageSrc] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [qrError, setQrError] = useState<string | null>(null)
  const [weixinSessionKey, setWeixinSessionKey] = useState<string | null>(null)

  const [qqAppId, setQqAppId] = useState('')
  const [qqSecret, setQqSecret] = useState('')

  const [wechatAccessToken, setWechatAccessToken] = useState('')
  const [wecomBotId, setWecomBotId] = useState('')
  const [wecomSecret, setWecomSecret] = useState('')

  const [fsAppId, setFsAppId] = useState('')
  const [fsSecret, setFsSecret] = useState('')

  const [dtClientId, setDtClientId] = useState('')
  const [dtSecret, setDtSecret] = useState('')
  const [unbindDialogOpen, setUnbindDialogOpen] = useState(false)

  const displayLabel = isRemoteBindPlatform(meta.id) ? REMOTE_CHANNEL_LABELS[meta.id] : meta.name

  useEffect(() => {
    if (!dialogOpen) {
      setQrImageSrc(null)
      setQrError(null)
      setWeixinSessionKey(null)
      setQrLoading(false)
    }
  }, [dialogOpen])

  useEffect(() => {
    if (!dialogOpen || isConfigured) return
    let cancelled = false

    async function loadWeixinQr() {
      setQrLoading(true)
      setQrError(null)
      try {
        const en = await fetch('/api/remote-channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ platform: 'weixin' }),
        })
        const enData = await en.json().catch(() => ({}))
        if (!en.ok) throw new Error(enData?.error || '启用微信通道失败')

        const res = await fetch('/api/remote-channels/qr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ platform: 'weixin' }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || '获取登录二维码失败')
        if (cancelled) return
        setQrImageSrc(typeof data.qrDataUrl === 'string' ? data.qrDataUrl : null)
        setWeixinSessionKey(typeof data.sessionKey === 'string' ? data.sessionKey : null)
      } catch (e: any) {
        if (!cancelled) setQrError(e?.message || '加载失败')
      } finally {
        if (!cancelled) setQrLoading(false)
      }
    }

    if (meta.id === 'weixin') {
      void loadWeixinQr()
    }

    return () => {
      cancelled = true
    }
  }, [dialogOpen, isConfigured, meta.id])

  const canSubmit = useMemo(() => {
    switch (meta.id) {
      case 'weixin':
        return Boolean(qrImageSrc && weixinSessionKey && !qrLoading && !qrError)
      case 'wechat_access':
        return wechatAccessToken.trim().length > 0
      case 'qq':
        return qqAppId.trim().length > 0 && qqSecret.trim().length > 0
      case 'wecom':
        return wecomBotId.trim().length > 0 && wecomSecret.trim().length > 0
      case 'feishu':
        return fsAppId.trim().length > 0 && fsSecret.trim().length > 0
      case 'dingtalk':
        return dtClientId.trim().length > 0 && dtSecret.trim().length > 0
      default:
        return false
    }
  }, [
    meta.id,
    qqAppId,
    qqSecret,
    wechatAccessToken,
    wecomBotId,
    wecomSecret,
    fsAppId,
    fsSecret,
    dtClientId,
    dtSecret,
    qrImageSrc,
    qrLoading,
    qrError,
    weixinSessionKey,
  ])

  const handleWeixinScanDone = async () => {
    if (!weixinSessionKey) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/remote-channels/qr/wait', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sessionKey: weixinSessionKey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: '登录失败',
          description: data?.error || res.statusText,
          variant: 'destructive',
        })
        return
      }
      if (!data.connected) {
        toast({
          title: '未完成登录',
          description: data?.message || '请重试或重新生成二维码',
          variant: 'destructive',
        })
        return
      }
      toast({ title: '微信已连接', description: data?.message || '扫码登录成功。' })
      onSuccess()
    } catch {
      toast({ title: '网络异常', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleConnect = async () => {
    setSubmitting(true)
    try {
      let body: Record<string, unknown> = { platform: meta.id }
      if (meta.id === 'qq') {
        body = { platform: 'qq', appId: qqAppId.trim(), clientSecret: qqSecret.trim() }
      } else if (meta.id === 'wecom') {
        body = {
          platform: 'wecom',
          botId: wecomBotId.trim(),
          secret: wecomSecret.trim(),
        }
      } else if (meta.id === 'wechat_access') {
        body = { platform: 'wechat_access', token: wechatAccessToken.trim() }
      } else if (meta.id === 'feishu') {
        body = { platform: 'feishu', appId: fsAppId.trim(), appSecret: fsSecret.trim() }
      } else if (meta.id === 'dingtalk') {
        body = {
          platform: 'dingtalk',
          clientId: dtClientId.trim(),
          clientSecret: dtSecret.trim(),
        }
      }

      const res = await fetch('/api/remote-channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: '保存失败',
          description: data?.error || res.statusText,
          variant: 'destructive',
        })
        return
      }
      toast({ title: '已保存', description: '配置已写入 openclaw.json，并已尝试热更新网关。' })
      onSuccess()
    } catch {
      toast({ title: '网络异常', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleUnbind = async () => {
    if (!isRemoteBindPlatform(meta.id)) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/remote-channels', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ platform: meta.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: '解绑失败',
          description: data?.error || res.statusText,
          variant: 'destructive',
        })
        return
      }
      toast({ title: '已解绑', description: '已清除本机通道凭据并关闭插件，并已尝试热更新网关。' })
      setUnbindDialogOpen(false)
      onSuccess()
    } catch {
      toast({ title: '网络异常', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-border/50">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'h-12 w-12 rounded-xl shrink-0 flex items-center justify-center text-white text-xs font-bold',
              meta.logoClass,
            )}
          >
            {meta.name.slice(0, 2)}
          </div>
          <div>
            <DialogTitle className="text-xl font-semibold text-left">{meta.name}</DialogTitle>
            <DialogDescription className="text-left mt-2 text-muted-foreground text-sm leading-relaxed">
              {meta.description}
            </DialogDescription>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 -mr-1" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-6 py-5 space-y-6 max-h-[70vh] overflow-y-auto">
        {isConfigured && isRemoteBindPlatform(meta.id) ? (
          <div className="space-y-5">
            <div className="rounded-xl border border-border/60 bg-muted/40 p-4 space-y-3">
              <p className="text-sm font-medium text-foreground">已配置</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                当前已接入「{displayLabel}」远控通道；展示名称仅作标识，凭据仅保存在本机{' '}
                <span className="font-mono text-xs">openclaw.json</span>，不在此界面回显。
              </p>
              <Badge variant="secondary" className="text-xs font-normal">
                {displayLabel}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full rounded-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={submitting}
              onClick={() => setUnbindDialogOpen(true)}
            >
              解绑
            </Button>
            <AlertDialog open={unbindDialogOpen} onOpenChange={setUnbindDialogOpen}>
              <AlertDialogContent className="rounded-2xl">
                <AlertDialogHeader>
                  <AlertDialogTitle>解绑「{displayLabel}」？</AlertDialogTitle>
                  <AlertDialogDescription>
                    将关闭对应插件并从配置中移除该通道的凭据。解绑后可重新打开本页填写并连接。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-2">
                  <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
                  <Button
                    type="button"
                    variant="destructive"
                    className="rounded-full"
                    disabled={submitting}
                    onClick={() => void handleUnbind()}
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '确认解绑'}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}

        {!isConfigured && meta.id === 'weixin' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">微信扫码登录</span>
              <GuideLinkButton href={meta.guideUrl} />
            </div>
            <div className="flex flex-col items-center gap-3 py-2 min-h-[240px] justify-center">
              {qrLoading ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  正在获取二维码…
                </p>
              ) : null}
              {qrError ? (
                <p className="text-sm text-destructive text-center px-2">{qrError}</p>
              ) : null}
              {qrImageSrc && !qrLoading ? (
                <img
                  src={qrImageSrc}
                  alt="微信登录二维码"
                  className="w-56 h-56 rounded-xl border border-border bg-white p-2 object-contain"
                />
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              请使用微信扫描上方二维码；二维码就绪后，方可点击「完成扫码并连接」。
            </p>
            <div className="flex justify-center pt-2">
              <Button
                className="rounded-full px-16 bg-foreground text-background disabled:opacity-40"
                disabled={!canSubmit || submitting}
                onClick={() => void handleWeixinScanDone()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '完成扫码并连接'}
              </Button>
            </div>
          </>
        ) : null}

        {!isConfigured && meta.id === 'wechat_access' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">腾讯通路 Token</span>
              <GuideLinkButton href={meta.guideUrl} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              请先在文档中完成腾讯侧开通与授权，取得通路 Token。本页仅保存凭据并启用插件；无 Token 无法建立连接，也不会显示为已配置。
            </p>
            <div className="space-y-2">
              <Label htmlFor="wechat-access-token">
                Token <span className="text-destructive">*</span>
              </Label>
              <SecretInput
                id="wechat-access-token"
                value={wechatAccessToken}
                onChange={setWechatAccessToken}
                placeholder="粘贴腾讯通路 Token"
              />
            </div>
            <div className="flex justify-center pt-2">
              <Button
                className="rounded-full px-16 bg-foreground text-background disabled:opacity-40"
                disabled={!canSubmit || submitting}
                onClick={() => void handleConnect()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存并启用'}
              </Button>
            </div>
          </>
        ) : null}

        {!isConfigured && meta.id === 'wecom' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">企业微信 · WebSocket</span>
              <GuideLinkButton href={meta.guideUrl} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              请在企业微信后台创建机器人并获取 Bot ID 与 Secret，填写下方凭据后保存。无凭据不会显示为已配置。
            </p>
            <div className="space-y-2">
              <Label htmlFor="wecom-bot">
                企微 Bot ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="wecom-bot"
                placeholder="请输入企业微信 Bot ID"
                value={wecomBotId}
                onChange={(e) => setWecomBotId(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wecom-sec">
                企微 Secret <span className="text-destructive">*</span>
              </Label>
              <SecretInput
                id="wecom-sec"
                value={wecomSecret}
                onChange={setWecomSecret}
                placeholder="请输入企业微信机器人 Secret"
              />
            </div>
            <div className="flex justify-center pt-2">
              <Button
                className="rounded-full px-16 w-full max-w-xs bg-foreground text-background disabled:opacity-40"
                disabled={!canSubmit || submitting}
                onClick={() => void handleConnect()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存并连接'}
              </Button>
            </div>
          </>
        ) : null}

        {!isConfigured && meta.id === 'qq' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">连接配置</span>
              <GuideLinkButton href={meta.guideUrl} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qq-aid">
                QQ 机器人 App ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="qq-aid"
                placeholder="请输入 QQ 开放平台 App ID"
                value={qqAppId}
                onChange={(e) => setQqAppId(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qq-sec">
                QQ 机器人 App Secret <span className="text-destructive">*</span>
              </Label>
              <SecretInput
                id="qq-sec"
                value={qqSecret}
                onChange={setQqSecret}
                placeholder="请输入 QQ 开放平台 App Secret"
              />
            </div>
            <div className="flex justify-center pt-2">
              <Button
                className="rounded-full px-16 w-full max-w-xs bg-foreground text-background disabled:opacity-40"
                disabled={!canSubmit || submitting}
                onClick={() => void handleConnect()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '连接'}
              </Button>
            </div>
          </>
        ) : null}

        {!isConfigured && meta.id === 'feishu' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">连接配置</span>
              <GuideLinkButton href={meta.guideUrl} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fs-aid">
                飞书 App ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="fs-aid"
                placeholder="请输入飞书 App ID"
                value={fsAppId}
                onChange={(e) => setFsAppId(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fs-sec">
                飞书 App Secret <span className="text-destructive">*</span>
              </Label>
              <SecretInput
                id="fs-sec"
                value={fsSecret}
                onChange={setFsSecret}
                placeholder="请输入飞书 App Secret"
              />
            </div>
            <div className="flex justify-center pt-2">
              <Button
                className="rounded-full px-16 w-full max-w-xs bg-foreground text-background disabled:opacity-40"
                disabled={!canSubmit || submitting}
                onClick={() => void handleConnect()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '连接'}
              </Button>
            </div>
          </>
        ) : null}

        {!isConfigured && meta.id === 'dingtalk' ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">连接配置</span>
              <GuideLinkButton href={meta.guideUrl} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dt-cid">
                钉钉 Client ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="dt-cid"
                placeholder="请输入钉钉开放平台 Client ID"
                value={dtClientId}
                onChange={(e) => setDtClientId(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dt-sec">
                钉钉 Client Secret <span className="text-destructive">*</span>
              </Label>
              <SecretInput
                id="dt-sec"
                value={dtSecret}
                onChange={setDtSecret}
                placeholder="请输入钉钉开放平台 Client Secret"
              />
            </div>
            <div className="flex justify-center pt-2">
              <Button
                className="rounded-full px-16 w-full max-w-xs bg-foreground text-background disabled:opacity-40"
                disabled={!canSubmit || submitting}
                onClick={() => void handleConnect()}
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '连接'}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
