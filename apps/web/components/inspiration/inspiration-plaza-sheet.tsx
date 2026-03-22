'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  INSPIRATION_CATEGORIES,
  INSPIRATION_ITEMS,
  flattenPromptParts,
  filterItemsByCategory,
  type InspirationCategoryId,
  type InspirationItem,
  type PromptPart,
} from './inspiration-plaza-data'

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

  const filtered = useMemo(() => {
    const byCat = filterItemsByCategory(INSPIRATION_ITEMS, category)
    const q = query.trim().toLowerCase()
    if (!q) return byCat
    return byCat.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle.toLowerCase().includes(q) ||
        item.scenarios.some((s) => s.toLowerCase().includes(q)),
    )
  }, [query, category])

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
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索灵感标题或场景"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="rounded-full border-border/80 bg-secondary/40 pl-9"
              />
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
                    <button
                      key={item.id}
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
    </>
  )
}
