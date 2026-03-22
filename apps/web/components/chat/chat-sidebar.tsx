'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Sparkles,
  Clock,
  Settings,
  User,
  RefreshCw,
  Puzzle,
  Wrench,
  MoreHorizontal,
  MonitorSmartphone,
  Pencil,
  Trash2,
  ArrowUpCircle,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useXClawStore, type Conversation } from '@/store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { filterConversationsByQuery } from './chat-helpers'
import { SkillPlazaSheet } from '@/components/skills/skill-plaza-sheet'
import { InspirationPlazaSheet } from '@/components/inspiration/inspiration-plaza-sheet'
import { RemoteChannelSheet } from '@/components/remote/remote-channel-sheet'
import { toast } from '@/hooks/use-toast'
import { loadConversationTitleOverrides, setConversationTitleOverride } from '@/lib/conversation-title-overrides'
import {
  addDismissedConversationId,
  loadDismissedConversationIds,
  pruneDismissedNotInRemote,
} from '@/lib/chat-dismissed-conversations'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  createAutoPendingConversation,
  createPendingConversation,
  isPendingConversation,
} from '@/lib/pending-conversation'
import { APP_VERSION } from '@/lib/version'
import { ReleaseCheckDialog } from '@/components/layout/release-check-dialog'

function groupConversationsByDate(conversations: Conversation[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const groups: { label: string; conversations: Conversation[] }[] = []
  const todayConvs: Conversation[] = []
  const olderConvs: Conversation[] = []
  
  conversations.forEach((conv) => {
    const convDate = new Date(conv.updatedAt * 1000)
    convDate.setHours(0, 0, 0, 0)
    
    if (convDate.getTime() === today.getTime()) {
      todayConvs.push(conv)
    } else {
      olderConvs.push(conv)
    }
  })
  
  if (todayConvs.length > 0) {
    groups.push({ label: '今天', conversations: todayConvs })
  }
  if (olderConvs.length > 0) {
    groups.push({ label: '更早', conversations: olderConvs })
  }
  
  return groups
}

const listItemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: i * 0.05,
      duration: 0.3,
      ease: 'easeOut',
    },
  }),
}

function isGatewayConversation(conversationId: string): boolean {
  return conversationId.startsWith('gw:')
}

function extractSessionKey(conversationId: string): string | null {
  if (!isGatewayConversation(conversationId)) return null
  const key = conversationId.slice(3).trim()
  return key.length > 0 ? key : null
}

function conversationDisplayTitle(conv: Conversation): string {
  return conv.customTitle?.trim() || conv.name || conv.id
}

export function ChatSidebar({
  onNavigateToChat,
  studioShell,
}: {
  onNavigateToChat?: () => void
  /** 与嵌入的 Star 办公室同色系侧栏（#1a1a2e） */
  studioShell?: boolean
} = {}) {
  const { conversations, activeConversation, setActiveConversation, setConversations, updateConversation } =
    useXClawStore()
  const [remoteConversations, setRemoteConversations] = useState<any[]>([])
  const [loadingRemote, setLoadingRemote] = useState(false)
  const [search, setSearch] = useState('')
  const [skillPlazaOpen, setSkillPlazaOpen] = useState(false)
  const [inspirationPlazaOpen, setInspirationPlazaOpen] = useState(false)
  const [remoteChannelOpen, setRemoteChannelOpen] = useState(false)
  const [deleteInProgress, setDeleteInProgress] = useState(false)
  const [renamingConversation, setRenamingConversation] = useState<Conversation | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [pendingDeleteConversation, setPendingDeleteConversation] = useState<Conversation | null>(null)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const router = useRouter()

  const handleLogout = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' })
      if (!res.ok) throw new Error('logout failed')
      router.replace('/login?next=%2F')
    } catch {
      toast({ title: '退出失败', description: '请稍后重试', variant: 'destructive' })
    }
  }, [router])

  /** 侧栏重命名：本地标题 + gw: 时同步 OpenClaw session.label（sessions.patch） */
  const commitConversationRename = async () => {
    if (!renamingConversation) return
    const trimmed = renameDraft.trim()
    if (!trimmed) {
      toast({ title: '标题不能为空', variant: 'destructive' })
      return
    }
    const convId = renamingConversation.id
    const isGw = isGatewayConversation(convId)
    updateConversation(convId, { name: trimmed, customTitle: trimmed })
    setRenamingConversation(null)

    if (!isGw) return

    try {
      const res = await fetch('/api/chat/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: convId, label: trimmed }),
      })
      const data = (await res.json().catch(() => ({}))) as { label?: string; error?: string }
      if (!res.ok) {
        toast({
          title: '远端标题未同步',
          description: typeof data.error === 'string' ? data.error : res.statusText,
          variant: 'destructive',
        })
        return
      }
      if (typeof data.label === 'string' && data.label.trim() && data.label.trim() !== trimmed) {
        const finalLabel = data.label.trim()
        updateConversation(convId, { name: finalLabel, customTitle: finalLabel })
      }
    } catch {
      toast({
        title: '远端标题未同步',
        description: '网络错误，请稍后重试。',
        variant: 'destructive',
      })
    }
  }

  const loadRemote = async (options?: { skipHistorySync?: boolean }) => {
    setLoadingRemote(true)
    try {
      // 可选：将网关转录写入本地 messages（会按会话 DELETE 再插入；无附件会话才安全，见 route 内跳过逻辑）
      if (!options?.skipHistorySync) {
        try {
          await fetch('/api/chat/history-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limitSessions: 40, limitMessages: 200 }),
          })
        } catch {
          // ignore history sync failures and keep current list behavior
        }
      }

      const response = await fetch('/api/chat/conversations?limit=100', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) return
      setRemoteConversations(Array.isArray(data.conversations) ? data.conversations : [])
    } catch {
      // keep local-only sidebar on failures
    } finally {
      setLoadingRemote(false)
    }
  }

  /** 默认不跑 history-sync：其会 DELETE 整段会话再按网关转录重建，易抹掉本地上传附件的 metadata（dataUrl 无法从网关找回） */
  useEffect(() => {
    void loadRemote({ skipHistorySync: true })
  }, [])

  useEffect(() => {
    const titleOverrides = loadConversationTitleOverrides()
    const currentConversations = useXClawStore.getState().conversations
    const remoteConversationIds = remoteConversations.map((item) => item.conversation_id)
    pruneDismissedNotInRemote(remoteConversationIds)
    const dismissed = loadDismissedConversationIds()
    const filteredRemote = remoteConversations.filter(
      (item) => !dismissed.has(item.conversation_id) && !String(item.conversation_id || '').startsWith('draft-'),
    )
    const mapped: Conversation[] = filteredRemote.map((item) => {
      const prev = currentConversations.find((c) => c.id === item.conversation_id)
      const defaultName = item.last_message?.content?.slice(0, 40) || item.conversation_id
      return {
        id: item.conversation_id,
        name: defaultName,
        customTitle: prev?.customTitle ?? titleOverrides[item.conversation_id],
        participants: [],
        unreadCount: Number(item.unread_count || 0),
        // Keep fallback deterministic to avoid render-loop churn.
        updatedAt: Number(item.last_message_at || item.last_message?.created_at || 0),
        lastMessage: item.last_message
          ? {
              id: item.last_message.id,
              conversation_id: item.last_message.conversation_id,
              from_agent: item.last_message.from_agent,
              to_agent: item.last_message.to_agent,
              content: item.last_message.content,
              message_type: item.last_message.message_type || 'text',
              metadata: item.last_message.metadata || undefined,
              created_at: item.last_message.created_at,
            }
          : undefined,
      }
    })
    const remoteIds = new Set(mapped.map((item) => item.id))
    const localOnly = currentConversations.filter((item) => {
      // 用户已删除并写入 dismissed 的会话不得再合并回来（否则 gw: 仅本地时删不掉）
      if (dismissed.has(item.id)) return false
      // 不再使用 draft-*：列表与 OpenClaw session 对齐，仅展示 gw: 与（网关失败时）conv-*
      if (item.id.startsWith('draft-')) return false
      if (item.id.startsWith('pending:auto:')) {
        return filteredRemote.length === 0
      }
      if (item.id.startsWith('pending:')) return true
      if (item.id.startsWith('conv-')) return true
      // 新建 gw: 会话尚未写入 messages 表时，远程列表不会出现；需保留在侧栏直至首条消息落库
      if (isGatewayConversation(item.id) && !remoteIds.has(item.id)) return true
      return false
    })
    const merged = [
      ...localOnly.filter((item) => !remoteIds.has(item.id)),
      ...mapped,
    ].sort((a, b) => b.updatedAt - a.updatedAt)

    if (merged.length === 0) {
      const pending = createAutoPendingConversation()
      setConversations([pending])
      setActiveConversation(pending.id)
      return
    }
    const sameOrderAndShape =
      merged.length === currentConversations.length &&
      merged.every((item, index) => {
        const current = currentConversations[index]
        return (
          current &&
          current.id === item.id &&
          current.updatedAt === item.updatedAt &&
          current.unreadCount === item.unreadCount
        )
      })

    if (!sameOrderAndShape) {
      setConversations(merged)
    }
    const hasActive = merged.some((item) => item.id === activeConversation)
    if (!hasActive && merged[0]?.id) setActiveConversation(merged[0].id)
  }, [remoteConversations, setConversations, activeConversation, setActiveConversation])

  /**
   * 网关在 OpenClaw 侧已删 session，但 xclaw 仍保留「仅前端、无 DB 消息」的 gw: 幽灵项时自动收敛。
   * 新建 gw 后 45s 内不处理，避免与 sessions.json 写入竞态。
   */
  useEffect(() => {
    const gwOnly = useXClawStore.getState().conversations.filter((c) => c.id.startsWith('gw:'))
    if (gwOnly.length === 0) return
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        const nowSec = Math.floor(Date.now() / 1000)
        const list = useXClawStore.getState().conversations.filter((c) => c.id.startsWith('gw:'))
        for (const conv of list) {
          if (cancelled) return
          if (nowSec - conv.updatedAt < 45) continue
          try {
            const res = await fetch(
              `/api/chat/session-usage?conversation_id=${encodeURIComponent(conv.id)}`,
              { cache: 'no-store' },
            )
            const data = await res.json().catch(() => ({}))
            if (cancelled) return
            if (
              data?.orphanShouldHide === true &&
              data?.available === false &&
              data?.reason === 'session_not_found'
            ) {
              setConversationTitleOverride(conv.id, null)
              addDismissedConversationId(conv.id)
              const snap = useXClawStore.getState()
              const next = snap.conversations.filter((x) => x.id !== conv.id)
              if (next.length === 0) {
                const p = createAutoPendingConversation()
                snap.setConversations([p])
                snap.setActiveConversation(p.id)
              } else {
                snap.setConversations(next)
                if (snap.activeConversation === conv.id) {
                  snap.setActiveConversation(next[0]?.id ?? null)
                }
              }
            }
          } catch {
            // ignore
          }
        }
      })()
    }, 700)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [conversations, remoteConversations])

  const mergedConversations = useMemo(() => {
    const normalized = conversations.map((conv) => ({
      ...conv,
      name: conversationDisplayTitle(conv),
    }))
    return filterConversationsByQuery(normalized, search)
  }, [conversations, search])

  const groups = groupConversationsByDate(mergedConversations)

  const handleSelectConversation = (conv: Conversation) => {
    setActiveConversation(conv.id)
    if (studioShell) onNavigateToChat?.()
  }

  /** 统一删除：gw: 会话先 best-effort 结束远端 Session，再隐藏本应用库中记录；否则仅本应用。 */
  const handleDeleteConversation = async (conversationId: string) => {
    setConversationTitleOverride(conversationId, null)
    const nextBase = conversations.filter((item) => item.id !== conversationId)
    const next = nextBase.length > 0 ? nextBase : [createAutoPendingConversation()]
    setConversations(next)
    if (activeConversation === conversationId) {
      setActiveConversation(next[0]?.id ?? null)
    }

    if (isPendingConversation(conversationId)) {
      return
    }

    if (isGatewayConversation(conversationId)) {
      const sessionKey = extractSessionKey(conversationId)
      if (sessionKey) {
        try {
          const gwRes = await fetch('/api/sessions', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionKey }),
          })
          const gwData = await gwRes.json().catch(() => ({}))
          if (!gwRes.ok) {
            toast({
              title: '远端 Session 未结束',
              description: `${typeof gwData?.error === 'string' ? gwData.error : gwRes.statusText}。将继续从本应用移除该会话。`,
              variant: 'destructive',
            })
          }
        } catch {
          toast({
            title: '远端请求失败',
            description: '将继续从本应用移除该会话。',
            variant: 'destructive',
          })
        }
      }
    }

    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // B2：后端未真删时仍写入 dismissed，避免 loadRemote 把同一会话顶回侧栏
        addDismissedConversationId(conversationId)
        toast({
          title: '无法从本应用移除会话',
          description:
            typeof data?.error === 'string'
              ? data.error
              : res.status === 403
                ? '没有权限或请重新登录后再试。'
                : res.statusText || '请稍后重试。',
          variant: 'destructive',
        })
        void loadRemote({ skipHistorySync: true })
        return
      }
      addDismissedConversationId(conversationId)
      void loadRemote({ skipHistorySync: true })
    } catch {
      addDismissedConversationId(conversationId)
      toast({
        title: '网络异常',
        description: '已在本机隐藏该会话；服务端若仍有记录，可稍后在设置中核对。',
        variant: 'destructive',
      })
      void loadRemote({ skipHistorySync: true })
    }
  }
  
  return (
    <div
      className={cn(
        'box-border flex h-full w-72 min-w-0 max-w-72 flex-none shrink-0 flex-col overflow-hidden border-r [contain:inline-size]',
        studioShell ? 'border-[#2a2a45] bg-[#1a1a2e]' : 'border-border/50 bg-sidebar',
      )}
    >
      {/* 搜索框 */}
      <div className="p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className={cn(
                'absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4',
                studioShell ? 'text-slate-500' : 'text-muted-foreground',
              )}
            />
            <Input
              placeholder="搜索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn(
                'pl-9 border-0 focus-visible:ring-1',
                studioShell
                  ? 'bg-[#151522]/90 text-slate-100 placeholder:text-slate-500 focus-visible:ring-[#64477d]'
                  : 'bg-secondary/50',
              )}
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className={cn('h-9 w-9', studioShell && 'text-slate-300 hover:bg-[#252540] hover:text-slate-100')}
            onClick={() => void loadRemote({ skipHistorySync: true })}
            disabled={loadingRemote}
          >
            <RefreshCw className={cn('h-4 w-4', loadingRemote && 'animate-spin')} />
          </Button>
        </div>
      </div>
      
      {/* 对话列表 */}
      <ScrollArea className="min-h-0 min-w-0 flex-1 px-2">
        <div className="w-full min-w-0 max-w-full overflow-x-hidden [contain:inline-size]">
        <AnimatePresence mode="wait">
          {groups.map((group) => (
            <div key={group.label} className="mb-4 min-w-0 max-w-full">
              <div
                className={cn(
                  'px-2 py-1.5 text-xs font-medium',
                  studioShell ? 'text-slate-500' : 'text-muted-foreground',
                )}
              >
                {group.label}
              </div>
              {group.conversations.map((conv, index) => {
                const title = conversationDisplayTitle(conv)
                return (
                  <motion.div
                    key={conv.id}
                    custom={index}
                    variants={listItemVariants}
                    initial="hidden"
                    animate="visible"
                    className={cn(
                      'group mb-1 w-full min-w-0 max-w-full overflow-x-hidden rounded-lg transition-colors',
                      studioShell
                        ? activeConversation === conv.id
                          ? 'bg-[#2a2a45] text-slate-100'
                          : 'text-slate-300 hover:bg-[#252540]'
                        : [
                            'hover:bg-sidebar-accent',
                            activeConversation === conv.id
                              ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground',
                          ],
                    )}
                  >
                    <div className="flex w-full min-w-0 max-w-full items-center gap-0.5 overflow-x-hidden">
                      <button
                        type="button"
                        onClick={() => handleSelectConversation(conv)}
                        className="min-h-0 min-w-0 w-0 flex-1 overflow-hidden px-3 py-2.5 text-left"
                      >
                        <span className="block min-w-0 truncate text-sm font-medium" title={title}>
                          {title}
                        </span>
                      </button>
                      <div className="flex shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              '!h-7 !w-7 !min-h-0 !min-w-0 shrink-0',
                              studioShell
                                ? 'text-slate-500 hover:text-slate-100'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                            aria-label="会话操作"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                          <DropdownMenuItem
                            onClick={() => {
                              setRenamingConversation(conv)
                              setRenameDraft(title)
                            }}
                          >
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            重命名
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setPendingDeleteConversation(conv)}
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          ))}
        </AnimatePresence>
        </div>
      </ScrollArea>
      
      {/* 底部快捷入口 */}
      <div className={cn('p-2 border-t', studioShell ? 'border-[#2a2a45]' : 'border-border/50')}>
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button
            type="button"
            variant="ghost"
            className={cn(
              'w-full justify-start gap-3 h-10',
              studioShell && 'text-slate-200 hover:bg-[#252540] hover:text-white',
            )}
            onClick={() => setInspirationPlazaOpen(true)}
          >
            <Sparkles className="h-4 w-4 text-primary" />
            <span>灵感广场</span>
          </Button>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button
            variant="ghost"
            className={cn('w-full justify-start gap-3 h-10', studioShell && 'text-slate-200 hover:bg-[#252540] hover:text-white')}
          >
            <Puzzle className="h-4 w-4" />
            <span>MCP 广场</span>
          </Button>
        </motion.div>

        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button
            type="button"
            variant="ghost"
            className={cn('w-full justify-start gap-3 h-10', studioShell && 'text-slate-200 hover:bg-[#252540] hover:text-white')}
            onClick={() => setSkillPlazaOpen(true)}
          >
            <Wrench className="h-4 w-4" />
            <span>技能广场</span>
          </Button>
        </motion.div>
        
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button
            type="button"
            variant="ghost"
            className={cn('w-full justify-start gap-3 h-10', studioShell && 'text-slate-200 hover:bg-[#252540] hover:text-white')}
            onClick={() => router.push('/settings/automation/cron')}
          >
            <Clock className="h-4 w-4" />
            <span>定时任务</span>
          </Button>
        </motion.div>
        
        {/* 用户信息和设置 */}
        <div
          className={cn(
            'flex items-center justify-between mt-2 pt-2 border-t',
            studioShell ? 'border-[#2a2a45]' : 'border-border/50',
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8 rounded-full p-0',
                  studioShell ? 'text-slate-200 hover:bg-[#252540]' : '',
                )}
                aria-label="账户菜单"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback
                    className={cn(
                      'text-xs',
                      studioShell ? 'bg-[#2a2a45] text-slate-200' : 'bg-primary/10 text-primary',
                    )}
                  >
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="min-w-[220px]">
              <DropdownMenuItem
                className="flex cursor-pointer items-center gap-2"
                onSelect={() => setReleaseDialogOpen(true)}
              >
                <ArrowUpCircle className="h-4 w-4 shrink-0" />
                <span className="flex-1">检测更新</span>
                <span className="text-muted-foreground text-xs tabular-nums">V{APP_VERSION}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="cursor-pointer"
                onSelect={() => void handleLogout()}
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn('h-8 w-8', studioShell ? 'text-slate-400 hover:text-slate-100' : 'text-muted-foreground')}
              title="远控通道"
              aria-label="远控通道"
              onClick={() => setRemoteChannelOpen(true)}
            >
              <MonitorSmartphone className="h-4 w-4" />
            </Button>
            <Link href="/settings">
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8', studioShell ? 'text-slate-400 hover:text-slate-100' : 'text-muted-foreground')}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <InspirationPlazaSheet
        open={inspirationPlazaOpen}
        onOpenChange={setInspirationPlazaOpen}
        onNavigateToChat={() => onNavigateToChat?.()}
      />
      <SkillPlazaSheet
        open={skillPlazaOpen}
        onOpenChange={setSkillPlazaOpen}
        onNavigateToChat={() => onNavigateToChat?.()}
      />
      <RemoteChannelSheet open={remoteChannelOpen} onOpenChange={setRemoteChannelOpen} />
      <ReleaseCheckDialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen} />

      <Dialog
        open={Boolean(renamingConversation)}
        onOpenChange={(open) => {
          if (!open) setRenamingConversation(null)
        }}
      >
        <DialogContent className={cn(studioShell && 'border-[#2a2a45] bg-[#1a1a2e] text-slate-100')}>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>
              将显示在左侧列表。网关会话（gw:）会同步为 OpenClaw 的 session 标题（label）。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            placeholder="会话标题"
            className={cn(
              studioShell &&
                'border-[#2a2a45] bg-[#151522]/90 text-slate-100 placeholder:text-slate-500 focus-visible:ring-[#64477d]',
            )}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitConversationRename()
              }
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenamingConversation(null)}>
              取消
            </Button>
            <Button type="button" onClick={() => void commitConversationRename()}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingDeleteConversation)}
        onOpenChange={(open) => {
          if (!open && !deleteInProgress) setPendingDeleteConversation(null)
        }}
      >
        <AlertDialogContent className={cn(studioShell && 'border-[#2a2a45] bg-[#1a1a2e] text-slate-100')}>
          <AlertDialogHeader>
            <AlertDialogTitle>删除？</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteConversation && isGatewayConversation(pendingDeleteConversation.id)
                ? '将先尝试结束 OpenClaw 远端 Session，再从本应用数据库中移除该会话及消息。'
                : '将从本应用数据库中移除该会话及消息，并自左侧列表隐藏。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteInProgress}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteInProgress || !pendingDeleteConversation}
              onClick={(event) => {
                event.preventDefault()
                const id = pendingDeleteConversation?.id
                if (!id) return
                setDeleteInProgress(true)
                void handleDeleteConversation(id).finally(() => {
                  setDeleteInProgress(false)
                  setPendingDeleteConversation(null)
                })
              }}
            >
              {deleteInProgress ? '处理中…' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
