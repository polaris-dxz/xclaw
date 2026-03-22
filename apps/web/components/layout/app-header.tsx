'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import { Moon, Sun, MessageSquarePlus } from 'lucide-react'
import { NavTabs } from './nav-tabs'
import { ReleaseCheckDialog } from './release-check-dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  DISMISSED_RELEASE_KEY,
  fetchReleaseCheck,
  getElectronUpdaterApi,
  type ReleaseCheckPayload,
} from '@/lib/release-check-client'
import { APP_VERSION } from '@/lib/version'

const FEEDBACK_EMAIL = 'polarisdu@outlook.com'

function openFeedbackMail() {
  const subject = '[xclaw] 问题反馈'
  const versionLabel = `v${APP_VERSION}`
  const os =
    typeof navigator !== 'undefined'
      ? `${navigator.platform || ''}${navigator.userAgent ? ` · ${navigator.userAgent}` : ''}`
      : ''
  const body = `您好，

【反馈类型】（请填写：Bug / 功能建议 / 使用疑问 / 其他）

【问题描述】


【复现步骤】（如适用，可写「无法稳定复现」）


【期望行为】


【环境信息】（已自动带出，可补充）
- 应用版本：${versionLabel}
- 系统 / UA：${os || '（未知）'}

【联系方式】（可选，便于回访）


感谢您的反馈！`

  const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  if (typeof window !== 'undefined') {
    window.location.href = url
  }
}

interface AppHeaderProps {
  tabs: Array<{ id: string; label: string }>
  activeTab: string
  onTabChange: (tab: string) => void
  onNewChat: () => void
  /** 与嵌入的 Star 办公室同色系顶栏（#1a1a2e） */
  variant?: 'default' | 'studio'
}

export function AppHeader({ tabs, activeTab, onTabChange, onNewChat, variant = 'default' }: AppHeaderProps) {
  const { theme, setTheme } = useTheme()
  const studio = variant === 'studio'

  const [badgeCheck, setBadgeCheck] = useState<ReleaseCheckPayload | null>(null)
  const [dismissedReleaseVersion, setDismissedReleaseVersion] = useState('')
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)

  useEffect(() => {
    try {
      setDismissedReleaseVersion(window.localStorage.getItem(DISMISSED_RELEASE_KEY) ?? '')
    } catch {
      setDismissedReleaseVersion('')
    }
  }, [])

  const refreshBadge = useCallback(async () => {
    try {
      const data = await fetchReleaseCheck()
      setBadgeCheck(data)
    } catch {
      setBadgeCheck(null)
    }
  }, [])

  const onReleaseCheckAfter = useCallback(() => {
    try {
      setDismissedReleaseVersion(window.localStorage.getItem(DISMISSED_RELEASE_KEY) ?? '')
    } catch {
      setDismissedReleaseVersion('')
    }
    void refreshBadge()
  }, [refreshBadge])

  useEffect(() => {
    void refreshBadge()
    const id = window.setInterval(() => void refreshBadge(), 6 * 60 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [refreshBadge])

  useEffect(() => {
    const api = getElectronUpdaterApi()
    if (!api?.onUpdaterStatus) return
    const off = api.onUpdaterStatus((payload) => {
      if (
        payload?.type === 'update-downloaded' ||
        payload?.type === 'update-available' ||
        payload?.type === 'update-not-available'
      ) {
        void refreshBadge()
      }
    })
    return off
  }, [refreshBadge])

  const showUpdateDot =
    !!badgeCheck &&
    (badgeCheck.readyToInstall === true ||
      (badgeCheck.updateAvailable === true &&
        !!badgeCheck.latestVersion &&
        badgeCheck.latestVersion !== dismissedReleaseVersion))

  return (
    <header
      className={cn(
        'h-12 flex items-center justify-between px-4 border-b backdrop-blur-xl',
        studio
          ? 'border-[#2a2a45] bg-[#1a1a2e]/95 text-slate-100'
          : 'border-border/50 bg-background/80',
      )}
    >
      {/* 左侧：主题切换 + 新建对话 */}
      <div className="flex items-center gap-4">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', studio && 'text-slate-200 hover:bg-white/10 hover:text-white')}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', bounce: 0.3 }}
                  key={theme}
                >
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </motion.div>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              <p>切换主题</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', studio && 'text-slate-200 hover:bg-white/10 hover:text-white')}
                onClick={onNewChat}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              <p>新建对话</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      
      {/* 中间：导航标签 */}
      <div className="absolute left-1/2 -translate-x-1/2">
        <NavTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} variant={studio ? 'studio' : 'default'} />
      </div>
      
      {/* 右侧：版本号 + 反馈 */}
      <div
        className={cn(
          'flex items-center gap-3 text-sm',
          studio ? 'text-slate-400' : 'text-muted-foreground',
        )}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setVersionDialogOpen(true)}
                className={cn(
                  'relative inline-flex items-center rounded-md px-2 py-1 text-sm transition-colors',
                  studio
                    ? 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                )}
              >
                v{APP_VERSION}
                {showUpdateDot ? (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background"
                    aria-hidden
                  />
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              <p>检查更新</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <ReleaseCheckDialog
          open={versionDialogOpen}
          onOpenChange={setVersionDialogOpen}
          onAfterCheck={onReleaseCheckAfter}
        />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-8', studio ? 'text-slate-400 hover:text-slate-100' : 'text-muted-foreground hover:text-foreground')}
          onClick={openFeedbackMail}
        >
          <MessageSquarePlus className="h-4 w-4 mr-1.5" />
          问题反馈
        </Button>
      </div>
    </header>
  )
}
