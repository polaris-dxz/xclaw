'use client'

import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import {
  INSPIRATION_CATEGORIES,
  flattenPromptParts,
  filterItemsByCategory,
  type InspirationCategoryId,
  type InspirationItem,
  type PromptPart,
} from '@/lib/inspirations/catalog'

const newPromptPart = (text = ''): PromptPart => ({ text, highlight: false })

function toSlugId(title: string) {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .slice(0, 40)
  const ts = Date.now().toString(36)
  return `${base || 'inspiration'}-${ts}`
}

function isValidPromptPart(v: unknown): v is PromptPart {
  if (!v || typeof v !== 'object') return false
  const obj = v as { text?: unknown; highlight?: unknown }
  return typeof obj.text === 'string' && (obj.highlight === undefined || typeof obj.highlight === 'boolean')
}

function isValidInspirationItem(v: unknown): v is InspirationItem {
  if (!v || typeof v !== 'object') return false
  const obj = v as Partial<InspirationItem>
  if (typeof obj.id !== 'string' || !obj.id.trim()) return false
  if (typeof obj.categoryId !== 'string') return false
  if (typeof obj.icon !== 'string') return false
  if (typeof obj.title !== 'string' || !obj.title.trim()) return false
  if (typeof obj.subtitle !== 'string') return false
  if (!Array.isArray(obj.scenarios) || !obj.scenarios.every((s) => typeof s === 'string')) return false
  if (!Array.isArray(obj.promptParts) || !obj.promptParts.every(isValidPromptPart)) return false
  if (obj.promptExtraParts !== undefined) {
    if (!Array.isArray(obj.promptExtraParts) || !obj.promptExtraParts.every(isValidPromptPart)) return false
  }
  return true
}

function PromptBody({ parts }: { parts: PromptPart[] }) {
  return (
    <p className="text-sm leading-relaxed text-foreground/90">
      {parts.map((p, i) =>
        p.highlight ? (
          <span key={i} className="font-medium text-[#1E80FF]">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  )
}

export function InspirationPlazaSheet({
  open,
  onOpenChange,
  onNavigateToChat,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigateToChat: () => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<InspirationCategoryId | 'all'>('all')
  const [detailItem, setDetailItem] = useState<InspirationItem | null>(null)
  const [customItems, setCustomItems] = useState<InspirationItem[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [addError, setAddError] = useState('')
  const [addDraft, setAddDraft] = useState(() => ({
    categoryId: 'learning' as InspirationCategoryId,
    icon: '💡',
    title: '',
    subtitle: '',
    scenarios: [''],
    promptParts: [newPromptPart('')],
    promptExtraParts: [] as PromptPart[],
  }))
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/inspirations', { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return
        const items = Array.isArray(data?.items) ? (data.items as InspirationItem[]) : []
        if (!cancelled) setCustomItems(items)
      } catch {
        // ignore: keep built-in inspirations only
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const allItems = useMemo(() => [...customItems], [customItems])

  const filtered = useMemo(() => {
    const byCat = filterItemsByCategory(allItems, category)
    const q = query.trim().toLowerCase()
    if (!q) return byCat
    return byCat.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.scenarios.some((s) => s.toLowerCase().includes(q)),
    )
  }, [query, category, allItems])

  const handleUseNow = (item: InspirationItem) => {
    const main = flattenPromptParts(item.promptParts)
    const extra = item.promptExtraParts?.length
      ? `\n\n${flattenPromptParts(item.promptExtraParts)}`
      : ''
    try {
      sessionStorage.setItem('xclaw.composerPrefill', `${main}${extra}`)
    } catch {
      // ignore
    }
    setDetailItem(null)
    onOpenChange(false)
    onNavigateToChat()
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('xclaw-composer-prefill'))
    })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(960px,96vw)]"
        >
          <SheetHeader className="border-b border-border/60 px-6 py-5 text-left">
            <SheetTitle className="text-xl">灵感广场</SheetTitle>
            <SheetDescription>按场景挑选 Prompt 模板，点击查看详情并一键填入对话</SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索灵感标题或场景"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="rounded-full border-border/80 bg-secondary/40 pl-9"
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="shrink-0 rounded-full"
                onClick={() => {
                  setAddError('')
                  setAddDraft({
                    categoryId: category === 'all' ? 'learning' : category,
                    icon: '💡',
                    title: '',
                    subtitle: '',
                    scenarios: [''],
                    promptParts: [newPromptPart('')],
                    promptExtraParts: [],
                  })
                  setAddOpen(true)
                }}
              >
                <Plus className="h-4 w-4" />
                添加灵感
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={category === 'all' ? 'default' : 'secondary'}
                className="rounded-full"
                onClick={() => setCategory('all')}
              >
                全部
              </Button>
              {INSPIRATION_CATEGORIES.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={category === c.id ? 'default' : 'secondary'}
                  className="rounded-full"
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </Button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pb-6">
              {filtered.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">暂无匹配的灵感，换个关键词或分类试试</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {filtered.map((item) => (
                    <ContextMenu key={item.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={() => setDetailItem(item)}
                          className="group flex flex-col rounded-2xl border border-border/70 bg-card p-4 text-left shadow-sm transition-shadow hover:shadow-md"
                        >
                          <div className="flex gap-3">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-2xl">
                              {item.icon}
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="font-semibold leading-tight group-hover:text-primary">{item.title}</h3>
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.subtitle}</p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {INSPIRATION_CATEGORIES.find((c) => c.id === item.categoryId)?.label ?? item.categoryId}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onSelect={() => {
                            setAddError('')
                            setEditingId(item.id)
                            setAddDraft({
                              categoryId: item.categoryId,
                              icon: item.icon,
                              title: item.title,
                              subtitle: item.subtitle,
                              scenarios: item.scenarios.length ? item.scenarios : [''],
                              promptParts: item.promptParts.length ? item.promptParts : [newPromptPart('')],
                              promptExtraParts: item.promptExtraParts || [],
                            })
                            setAddOpen(true)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                          编辑
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => {
                            const ok = confirm(`确定删除「${item.title}」？`)
                            if (!ok) return
                            setCustomItems((prev) => prev.filter((x) => x.id !== item.id))
                            void fetch(`/api/inspirations?id=${encodeURIComponent(item.id)}`, {
                              method: 'DELETE',
                            }).catch(() => {
                              // ignore
                            })
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                          删除
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={detailItem !== null} onOpenChange={(o) => !o && setDetailItem(null)}>
        <DialogContent
          showCloseButton
          className="max-h-[85vh] overflow-y-auto rounded-[20px] border-0 p-0 shadow-xl sm:max-w-md"
        >
          {detailItem && (
            <div className="px-6 pb-6 pt-6">
              <DialogTitle className="sr-only">{detailItem.title}</DialogTitle>
              <div className="border-b border-border/60 pb-5 text-center">
                <div className="mb-3 text-4xl leading-none">{detailItem.icon}</div>
                <h2 className="text-lg font-semibold leading-snug text-foreground">{detailItem.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{detailItem.subtitle}</p>
              </div>

              <div className="mt-5 space-y-5">
                <section>
                  <h3 className="mb-2 text-left text-sm font-semibold text-foreground">适用场景</h3>
                  <div className="rounded-xl bg-[#F7F7F7] px-4 py-3 dark:bg-muted/50">
                    <ul className="space-y-2 text-left text-sm leading-relaxed text-foreground/85">
                      {detailItem.scenarios.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                </section>

                <section>
                  <h3 className="mb-2 text-left text-sm font-semibold text-foreground">Prompt</h3>
                  <div className="rounded-xl bg-[#F7F7F7] px-4 py-3 dark:bg-muted/50">
                    <PromptBody parts={detailItem.promptParts} />
                    {detailItem.promptExtraParts?.length ? (
                      <div className="mt-3 border-t border-border/40 pt-3">
                        <PromptBody parts={detailItem.promptExtraParts} />
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>

              <div className="mt-5 flex justify-center">
                <Button
                  type="button"
                  className="h-11 min-w-[200px] rounded-full px-6"
                  onClick={() => handleUseNow(detailItem)}
                >
                  立即使用
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o)
          if (!o) setEditingId(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto rounded-[20px] p-0 shadow-xl sm:max-w-2xl">
          <div className="px-6 pb-6 pt-6 space-y-4">
            <DialogTitle className="text-base font-semibold">{editingId ? '编辑灵感' : '添加灵感'}</DialogTitle>
            <p className="text-sm text-muted-foreground">按表单填写。保存后会写入本机浏览器存储（仅当前设备可见）。</p>

            <div className="space-y-5">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">基础信息</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">分类</label>
                    <div className="flex flex-wrap gap-2">
                      {INSPIRATION_CATEGORIES.map((c) => (
                        <Button
                          key={c.id}
                          type="button"
                          size="sm"
                          variant={addDraft.categoryId === c.id ? 'default' : 'secondary'}
                          className="rounded-full"
                          onClick={() => setAddDraft((d) => ({ ...d, categoryId: c.id }))}
                        >
                          {c.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">图标（emoji）</label>
                    <Input
                      value={addDraft.icon}
                      onChange={(e) => setAddDraft((d) => ({ ...d, icon: e.target.value }))}
                      className="rounded-xl"
                      placeholder="💡"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs text-muted-foreground">标题</label>
                    <Input
                      value={addDraft.title}
                      onChange={(e) => setAddDraft((d) => ({ ...d, title: e.target.value }))}
                      className="rounded-xl"
                      placeholder="例如：制定轻量学习规划"
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs text-muted-foreground">副标题</label>
                    <Input
                      value={addDraft.subtitle}
                      onChange={(e) => setAddDraft((d) => ({ ...d, subtitle: e.target.value }))}
                      className="rounded-xl"
                      placeholder="一句话描述（可留空）"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">适用场景</h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => setAddDraft((d) => ({ ...d, scenarios: [...d.scenarios, ''] }))}
                  >
                    <Plus className="h-4 w-4" />
                    添加一条
                  </Button>
                </div>
                <div className="rounded-xl bg-[#F7F7F7] px-4 py-3 dark:bg-muted/50 space-y-2">
                  {addDraft.scenarios.map((s, idx) => (
                    <div key={idx} className="flex gap-2">
                      <Input
                        value={s}
                        onChange={(e) =>
                          setAddDraft((d) => ({
                            ...d,
                            scenarios: d.scenarios.map((x, i) => (i === idx ? e.target.value : x)),
                          }))
                        }
                        className="rounded-xl bg-background/40"
                        placeholder="例如：考前备考迷茫📚：分阶段定制复习计划，助力提分；"
                      />
                      {addDraft.scenarios.length > 1 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-xl"
                          onClick={() =>
                            setAddDraft((d) => ({ ...d, scenarios: d.scenarios.filter((_, i) => i !== idx) }))
                          }
                        >
                          删除
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Prompt</h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => setAddDraft((d) => ({ ...d, promptParts: [...d.promptParts, newPromptPart('')] }))}
                  >
                    <Plus className="h-4 w-4" />
                    添加一段
                  </Button>
                </div>
                <div className="rounded-xl bg-[#F7F7F7] px-4 py-3 dark:bg-muted/50 space-y-2">
                  {addDraft.promptParts.map((p, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(p.highlight)}
                        onChange={(e) =>
                          setAddDraft((d) => ({
                            ...d,
                            promptParts: d.promptParts.map((x, i) =>
                              i === idx ? { ...x, highlight: e.target.checked } : x,
                            ),
                          }))
                        }
                      />
                      <Input
                        value={p.text}
                        onChange={(e) =>
                          setAddDraft((d) => ({
                            ...d,
                            promptParts: d.promptParts.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)),
                          }))
                        }
                        className="rounded-xl bg-background/40"
                        placeholder="例如：帮我制定一个"
                      />
                      {addDraft.promptParts.length > 1 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-xl"
                          onClick={() =>
                            setAddDraft((d) => ({ ...d, promptParts: d.promptParts.filter((_, i) => i !== idx) }))
                          }
                        >
                          删除
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  <div className="pt-2">
                    <p className="text-xs text-muted-foreground">预览：</p>
                    <PromptBody parts={addDraft.promptParts} />
                  </div>
                </div>
              </section>
            </div>

            {addError ? <p className="text-sm text-destructive">{addError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                取消
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setAddError('')
                  const title = addDraft.title.trim()
                  if (!title) {
                    setAddError('请填写标题。')
                    return
                  }
                  const scenarios = addDraft.scenarios.map((s) => s.trim()).filter(Boolean)
                  if (scenarios.length === 0) {
                    setAddError('请至少填写一条适用场景。')
                    return
                  }
                  const promptParts = addDraft.promptParts.map((p) => ({ ...p, text: p.text.trim() })).filter((p) => p.text)
                  if (promptParts.length === 0) {
                    setAddError('请至少填写一段 Prompt。')
                    return
                  }
                  const item: InspirationItem = {
                    id: editingId || toSlugId(title),
                    categoryId: addDraft.categoryId,
                    icon: (addDraft.icon || '💡').trim(),
                    title,
                    subtitle: addDraft.subtitle.trim(),
                    scenarios,
                    promptParts,
                  }
                  if (!isValidInspirationItem(item)) {
                    setAddError('内容不完整，请检查必填项。')
                    return
                  }
                  setCustomItems((prev) => {
                    const next = prev.filter((x) => x.id !== item.id)
                    next.unshift(item)
                    void fetch('/api/inspirations', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(item),
                    }).catch(() => {
                      // ignore
                    })
                    return next
                  })
                  setEditingId(null)
                  setAddOpen(false)
                }}
              >
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
