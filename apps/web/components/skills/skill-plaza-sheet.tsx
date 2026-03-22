'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Cloud,
  Github,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Puzzle,
  Search,
  Store,
} from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'

const TOGGLE_STORAGE_KEY = 'xclaw.skillToggle.v1'

type SkillRow = {
  id: string
  name: string
  source: string
  description?: string
  builtin?: boolean
}

type RegistrySource = 'clawhub' | 'skills-sh' | 'awesome-openclaw'

function readToggleMap(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(TOGGLE_STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, boolean>
  } catch {
    return {}
  }
}

/** OpenClaw 使用 skills.entries.<name>.enabled；无文件或未加载时回退 localStorage */
function computeSkillEnabled(
  skill: SkillRow,
  prefsEntries: Record<string, { enabled?: boolean }> | null,
  prefsMissing: boolean,
  toggleMap: Record<string, boolean>,
): boolean {
  if (prefsEntries !== null && !prefsMissing) {
    return prefsEntries[skill.name]?.enabled !== false
  }
  return toggleMap[skill.id] !== false
}

export function SkillPlazaSheet({
  open,
  onOpenChange,
  onNavigateToChat,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigateToChat: () => void
}) {
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [toggleMap, setToggleMap] = useState<Record<string, boolean>>({})
  /** 来自 ~/.xclaw 或 ~/.openclaw 的 openclaw.json → skills.entries */
  const [prefsEntries, setPrefsEntries] = useState<Record<string, { enabled?: boolean }> | null>(null)
  const [prefsMissing, setPrefsMissing] = useState(false)

  const [githubOpen, setGithubOpen] = useState(false)
  const [githubUrl, setGithubUrl] = useState('')
  const [githubBusy, setGithubBusy] = useState(false)

  const [registryOpen, setRegistryOpen] = useState(false)
  const [registrySource, setRegistrySource] = useState<RegistrySource>('skills-sh')
  const [registryQuery, setRegistryQuery] = useState('')
  const [registryLoading, setRegistryLoading] = useState(false)
  const [registryHits, setRegistryHits] = useState<
    { slug: string; name: string; description?: string }[]
  >([])
  const [installingSlug, setInstallingSlug] = useState<string | null>(null)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailTitle, setDetailTitle] = useState('')
  const [detailBody, setDetailBody] = useState('')

  /** 关闭开关前二次确认 */
  const [disableConfirmSkill, setDisableConfirmSkill] = useState<SkillRow | null>(null)

  const loadPreferences = useCallback(async () => {
    try {
      const res = await fetch('/api/skills/preferences', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return
      setPrefsEntries(data.entries && typeof data.entries === 'object' ? data.entries : {})
      setPrefsMissing(Boolean(data.missing))
    } catch {
      setPrefsEntries(null)
      setPrefsMissing(true)
    }
  }, [])

  const loadSkills = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/skills', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: '加载失败', description: data?.error || res.statusText, variant: 'destructive' })
        return
      }
      setSkills(Array.isArray(data.skills) ? data.skills : [])
    } catch {
      toast({ title: '网络异常', description: '无法加载技能列表', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setToggleMap(readToggleMap())
    void loadSkills()
    void loadPreferences()
  }, [open, loadSkills, loadPreferences])

  const setEnabledLocalOnly = (id: string, enabled: boolean) => {
    setToggleMap((prev) => {
      const next = { ...prev, [id]: enabled }
      try {
        localStorage.setItem(TOGGLE_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  const persistSkillEnabled = useCallback(async (skill: SkillRow, enabled: boolean) => {
    try {
      const res = await fetch('/api/skills/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: skill.name, enabled }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setPrefsEntries((prev) => ({
          ...(prev || {}),
          [skill.name]: { ...(prev?.[skill.name] || {}), enabled },
        }))
        setPrefsMissing(false)
        if (data.hotApply === false) {
          toast({
            title: '已保存到 openclaw.json',
            description: '网关热重载未返回成功，若未生效请重启 OpenClaw。',
          })
        }
        return true
      }
      if (res.status === 404) {
        setEnabledLocalOnly(skill.id, enabled)
        toast({
          title: '已仅在浏览器记住',
          description:
            data?.error ||
            '未找到用户 openclaw.json，请先启动 xclaw 桌面端生成配置；当前仅本地生效。',
        })
        return true
      }
      toast({ title: '保存失败', description: data?.error || res.statusText, variant: 'destructive' })
      return false
    } catch {
      toast({ title: '保存失败', variant: 'destructive' })
      return false
    }
  }, [])

  const handleSkillSwitchChange = (skill: SkillRow, nextChecked: boolean) => {
    if (nextChecked) {
      void persistSkillEnabled(skill, true)
      return
    }
    if (!computeSkillEnabled(skill, prefsEntries, prefsMissing, toggleMap)) return
    setDisableConfirmSkill(skill)
  }

  const confirmDisableSkill = () => {
    if (!disableConfirmSkill) return
    const s = disableConfirmSkill
    setDisableConfirmSkill(null)
    void persistSkillEnabled(s, false)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description || '').toLowerCase().includes(q) ||
        s.source.toLowerCase().includes(q),
    )
  }, [skills, query])

  const handleCreateViaChat = () => {
    try {
      sessionStorage.setItem(
        'xclaw.composerPrefill',
        '我想创建一个新技能，请根据我的描述生成 SKILL.md（含 frontmatter name / description）：\n',
      )
    } catch {
      // ignore
    }
    onOpenChange(false)
    onNavigateToChat()
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('xclaw-composer-prefill'))
    })
  }

  const handleGithubImport = async () => {
    if (!githubUrl.trim()) {
      toast({ title: '请填写链接', variant: 'destructive' })
      return
    }
    setGithubBusy(true)
    try {
      const res = await fetch('/api/skills/import-github', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: githubUrl.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: '拉取失败', description: data?.error || res.statusText, variant: 'destructive' })
        return
      }
      const install = await fetch('/api/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'openclaw',
          name: data.name,
          content: data.content,
        }),
      })
      const installData = await install.json().catch(() => ({}))
      if (!install.ok) {
        toast({ title: '安装失败', description: installData?.error || install.statusText, variant: 'destructive' })
        return
      }
      toast({ title: '技能已添加', description: data.name })
      setGithubOpen(false)
      setGithubUrl('')
      void loadSkills()
    } catch {
      toast({ title: '导入失败', variant: 'destructive' })
    } finally {
      setGithubBusy(false)
    }
  }

  const handleRegistrySearch = async () => {
    const q = registryQuery.trim()
    if (!q) {
      toast({ title: '请输入关键词', variant: 'destructive' })
      return
    }
    setRegistryLoading(true)
    try {
      const res = await fetch(
        `/api/skills/registry?source=${encodeURIComponent(registrySource)}&q=${encodeURIComponent(q)}`,
        { cache: 'no-store' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: '搜索失败', description: data?.error || res.statusText, variant: 'destructive' })
        setRegistryHits([])
        return
      }
      const rows = Array.isArray(data.skills) ? data.skills : []
      setRegistryHits(
        rows.map((r: { slug?: string; name?: string; description?: string }) => ({
          slug: String(r.slug || ''),
          name: String(r.name || r.slug || ''),
          description: r.description,
        })),
      )
    } catch {
      toast({ title: '搜索失败', variant: 'destructive' })
      setRegistryHits([])
    } finally {
      setRegistryLoading(false)
    }
  }

  const handleRegistryInstall = async (slug: string) => {
    if (!slug) return
    setInstallingSlug(slug)
    try {
      const res = await fetch('/api/skills/registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: registrySource, slug, targetRoot: 'openclaw' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: '安装失败', description: data?.message || data?.error || res.statusText, variant: 'destructive' })
        return
      }
      toast({ title: '安装成功', description: slug })
      void loadSkills()
    } catch {
      toast({ title: '安装失败', variant: 'destructive' })
    } finally {
      setInstallingSlug(null)
    }
  }

  const openSkillDetail = async (skill: SkillRow) => {
    setDetailOpen(true)
    setDetailTitle(skill.name)
    setDetailBody('')
    setDetailLoading(true)
    try {
      const res = await fetch(
        `/api/skills?mode=content&source=${encodeURIComponent(skill.source)}&name=${encodeURIComponent(skill.name)}`,
        { cache: 'no-store' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDetailBody(data?.error || '无法读取 SKILL.md')
        return
      }
      setDetailBody(typeof data.content === 'string' ? data.content : '')
    } catch {
      setDetailBody('读取失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleDelete = async (skill: SkillRow) => {
    if (skill.builtin) return
    if (!confirm(`确定移除技能「${skill.name}」？`)) return
    try {
      const res = await fetch(
        `/api/skills?source=${encodeURIComponent(skill.source)}&name=${encodeURIComponent(skill.name)}`,
        { method: 'DELETE' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: '移除失败', description: data?.error || res.statusText, variant: 'destructive' })
        return
      }
      toast({ title: '已移除', description: skill.name })
      void loadSkills()
    } catch {
      toast({ title: '移除失败', variant: 'destructive' })
    }
  }

  return (
    <>
      <AlertDialog
        open={disableConfirmSkill !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDisableConfirmSkill(null)
        }}
      >
        <AlertDialogContent className="rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>确认关闭该技能？</AlertDialogTitle>
            <AlertDialogDescription>
              关闭此技能会影响对话任务正常使用，可能导致输出效果不佳，请谨慎操作。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-end">
            <AlertDialogAction
              className="rounded-full"
              onClick={() => {
                confirmDisableSkill()
              }}
            >
              关闭
            </AlertDialogAction>
            <AlertDialogCancel className="rounded-full">取消</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(960px,96vw)]"
        >
          <SheetHeader className="border-b border-border/60 px-6 py-5 text-left">
            <SheetTitle className="text-xl">技能广场</SheetTitle>
            <SheetDescription>
              为您的智能体提供预封装且可重复的最佳实践与工具
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索已经安装的技能"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="rounded-full border-border/80 bg-secondary/40 pl-9"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-full shrink-0">
                    + 添加技能
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuItem className="flex flex-col items-start gap-0.5 py-2" onClick={handleCreateViaChat}>
                    <span className="flex items-center gap-2 font-medium">
                      <MessageSquare className="h-4 w-4" />
                      通过对话创建
                    </span>
                    <span className="text-xs text-muted-foreground pl-6">描述你的需求，AI 帮你生成</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex flex-col items-start gap-0.5 py-2"
                    onClick={() => {
                      setGithubOpen(true)
                    }}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Github className="h-4 w-4" />
                      从 GitHub 导入
                    </span>
                    <span className="text-xs text-muted-foreground pl-6">粘贴 raw 或 blob 链接以拉取 SKILL.md</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="flex flex-col items-start gap-0.5 py-2"
                    onClick={() => {
                      setRegistryOpen(true)
                      setRegistryHits([])
                    }}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      <Store className="h-4 w-4" />
                      从技能广场（注册表）添加
                    </span>
                    <span className="text-xs text-muted-foreground pl-6">搜索 ClawdHub / skills.sh 等并安装</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  加载中...
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">暂无技能，试试添加一个</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {filtered.map((skill) => {
                    const enabled = computeSkillEnabled(skill, prefsEntries, prefsMissing, toggleMap)
                    const isBuiltin = Boolean(skill.builtin)
                    return (
                      <div
                        key={skill.id}
                        className="group relative flex flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
                      >
                        <div className="flex gap-3">
                          <div
                            className={cn(
                              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                              isBuiltin ? 'bg-orange-500/15 text-orange-600' : 'bg-primary/10 text-primary',
                            )}
                          >
                            {isBuiltin ? <Puzzle className="h-5 w-5" /> : <Cloud className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <h3 className="truncate font-semibold leading-tight">{skill.name}</h3>
                                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                  {skill.description || '暂无描述'}
                                </p>
                              </div>
                              <Switch
                                checked={enabled}
                                onCheckedChange={(v) => handleSkillSwitchChange(skill, v)}
                                aria-label={enabled ? '启用技能' : '停用技能'}
                              />
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <Badge variant="secondary" className="text-[10px] font-normal">
                                {isBuiltin ? '内置技能' : '自定义技能'}
                              </Badge>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => void openSkillDetail(skill)}>查看 SKILL.md</DropdownMenuItem>
                                  {!isBuiltin && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        variant="destructive"
                                        onClick={() => void handleDelete(skill)}
                                      >
                                        移除技能
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={githubOpen} onOpenChange={setGithubOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>从 GitHub 导入</DialogTitle>
            <DialogDescription>
              粘贴 GitHub 上 SKILL.md 的 raw 地址，或仓库内文件的浏览页链接（将自动转换为 raw）。
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="https://raw.githubusercontent.com/..."
            value={githubUrl}
            onChange={(e) => setGithubUrl(e.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setGithubOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void handleGithubImport()} disabled={githubBusy}>
              {githubBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : '导入并安装'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={registryOpen} onOpenChange={setRegistryOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>从技能广场添加</DialogTitle>
            <DialogDescription>搜索公开注册表并安装到 OpenClaw 技能目录（部分操作需管理员权限）。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={registrySource}
              onChange={(e) => setRegistrySource(e.target.value as RegistrySource)}
            >
              <option value="skills-sh">skills.sh</option>
              <option value="clawhub">ClawdHub</option>
              <option value="awesome-openclaw">Awesome OpenClaw</option>
            </select>
            <div className="flex flex-1 gap-2">
              <Input
                placeholder="搜索关键词"
                value={registryQuery}
                onChange={(e) => setRegistryQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleRegistrySearch()
                }}
              />
              <Button type="button" variant="secondary" onClick={() => void handleRegistrySearch()} disabled={registryLoading}>
                {registryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
              </Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/60">
            {registryHits.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">输入关键词并搜索</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {registryHits.map((h) => (
                  <li key={h.slug} className="flex items-start justify-between gap-2 p-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{h.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{h.description}</div>
                      <div className="mt-1 text-[10px] text-muted-foreground truncate">{h.slug}</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!h.slug || installingSlug === h.slug}
                      onClick={() => void handleRegistryInstall(h.slug)}
                    >
                      {installingSlug === h.slug ? <Loader2 className="h-3 w-3 animate-spin" /> : '安装'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-3xl flex flex-col">
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
            <DialogDescription>SKILL.md 内容</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap">
            {detailLoading ? '加载中...' : detailBody || '无内容'}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
