'use client'

import { useState, useRef, KeyboardEvent, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Brain, ArrowUp, Paperclip, Square } from 'lucide-react'
import { useXClawStore, type ChatAttachment } from '@/store'
import { useChatStore } from '@/lib/store/chat-store'
import { ModelPicker } from '@/components/chat/model-picker'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { extractMentionQuery, insertMentionAtCursor } from './chat-helpers'
import { toast } from '@/hooks/use-toast'
import { STUDIO_COMPOSER_AGENT_SESSION_KEY } from '@/lib/studio/composer-session'

export type ChatTokenUsageLine = {
  used: number
  contextLimit: number
  contextIsEstimated: boolean
  pct: number | null
}

interface MessageInputProps {
  onSendMessage: (content: string, attachments?: ChatAttachment[], selectedAgent?: string, selectedModel?: string) => void
  onStopGenerating?: () => void
  /** 网关会话（gw:）的 token 用量；非 gw 或未拉取时为 null */
  tokenUsage?: ChatTokenUsageLine | null
  tokenUsageLoading?: boolean
}

const LOCAL_SELECTED_MODEL_KEY = 'mc-selected-model'

type ChatModelOption = { ref: string; label: string }

function formatTokenShort(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(Math.round(n))
}

export function MessageInput({
  onSendMessage,
  onStopGenerating,
  tokenUsage = null,
  tokenUsageLoading = false,
}: MessageInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    isSendingMessage,
    isAwaitingReply,
    setChatInput,
    agents,
    activeConversation,
    awaitingConversationId,
  } = useXClawStore()
  /** 全局 isAwaitingReply 未按会话区分时，切换会话后仍会误显「进行中」 */
  const showStopForAwaiting =
    isAwaitingReply &&
    awaitingConversationId != null &&
    activeConversation != null &&
    awaitingConversationId === activeConversation
  const showStopButton = showStopForAwaiting || isSendingMessage
  const selectedModelRef = useChatStore((s) => s.selectedModelRef)
  const setSelectedModelRef = useChatStore((s) => s.setSelectedModelRef)
  const customModels = useChatStore((s) => s.customModels)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const modelTriggerRef = useRef<HTMLDivElement>(null)
  const [chatModelOptions, setChatModelOptions] = useState<ChatModelOption[]>([
    { ref: 'default', label: '跟随系统默认' },
  ])
  const [selectedAgent, setSelectedAgent] = useState('all')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  /** FileReader 异步；未完成前禁止发送，否则 attachments 仍为空 */
  const [attachmentLoading, setAttachmentLoading] = useState(false)
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIndex, setMentionIndex] = useState(0)

  const selectedModelLabel = useMemo(() => {
    const hit = chatModelOptions.find((o) => o.ref === selectedModelRef)
    if (hit) return hit.label
    const custom = customModels.find((m) => m.ref === selectedModelRef)
    return custom?.name || selectedModelRef
  }, [chatModelOptions, selectedModelRef, customModels])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCAL_SELECTED_MODEL_KEY)
      if (saved) setSelectedModelRef(saved)
    } catch {
      // ignore persisted model read errors
    }
  }, [setSelectedModelRef])

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STUDIO_COMPOSER_AGENT_SESSION_KEY)
      if (saved && saved.trim()) setSelectedAgent(saved.trim())
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(STUDIO_COMPOSER_AGENT_SESSION_KEY, selectedAgent)
    } catch {
      // ignore
    }
  }, [selectedAgent])

  const COMPOSER_PREFILL_KEY = 'xclaw.composerPrefill'
  const applyComposerPrefill = () => {
    try {
      const pre = sessionStorage.getItem(COMPOSER_PREFILL_KEY)
      if (!pre) return
      sessionStorage.removeItem(COMPOSER_PREFILL_KEY)
      setMessage(pre)
      setChatInput(pre)
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    applyComposerPrefill()
    const onPrefill = () => applyComposerPrefill()
    window.addEventListener('xclaw-composer-prefill', onPrefill)
    return () => window.removeEventListener('xclaw-composer-prefill', onPrefill)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadChatModels = async () => {
      try {
        const response = await fetch('/api/openclaw/models', { cache: 'no-store' })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || cancelled) return
        const opts = Array.isArray(data?.chatOptions) ? data.chatOptions : []
        if (opts.length > 0) {
          setChatModelOptions(opts as ChatModelOption[])
        }
        try {
          const saved = localStorage.getItem(LOCAL_SELECTED_MODEL_KEY)
          if (saved && opts.some((o: ChatModelOption) => o.ref === saved)) {
            setSelectedModelRef(saved)
          } else if (typeof data?.primary === 'string' && data.primary.trim()) {
            const p = data.primary.trim()
            if (opts.some((o: ChatModelOption) => o.ref === p)) setSelectedModelRef(p)
          }
        } catch {
          // ignore
        }
      } catch {
        // keep default UI state
      }
    }
    void loadChatModels()
    return () => {
      cancelled = true
    }
  }, [])

  const mentionCandidates = useMemo(() => {
    const list = agents.map((agent) => ({ name: agent.name, role: agent.role }))
    if (!mentionFilter.trim()) return list
    const q = mentionFilter.toLowerCase()
    return list.filter((item) => item.name.toLowerCase().includes(q))
  }, [agents, mentionFilter])

  const MAX_ATTACH_BYTES = 10 * 1024 * 1024
  const MAX_ATTACH_COUNT = 8

  const readOneFileAsAttachment = (file: File): Promise<ChatAttachment | null> =>
    new Promise((resolve) => {
      if (file.size > MAX_ATTACH_BYTES) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result || '')
        if (!dataUrl.startsWith('data:')) {
          resolve(null)
          return
        }
        resolve({
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
        })
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })

  const addFilesFromList = async (files: FileList | File[]) => {
    const list = Array.from(files)
    let skippedOversized = 0
    for (const f of list) {
      if (f.size > MAX_ATTACH_BYTES) skippedOversized++
    }
    if (skippedOversized > 0) {
      toast({
        title: '部分文件已跳过',
        description: `超过 ${MAX_ATTACH_BYTES / (1024 * 1024)}MB 的文件无法上传（${skippedOversized} 个）`,
      })
    }
    setAttachmentLoading(true)
    try {
      const results = await Promise.all(list.map(readOneFileAsAttachment))
      const valid = results.filter((r): r is ChatAttachment => r != null)
      if (valid.length === 0 && list.length > 0 && skippedOversized < list.length) {
        toast({ title: '无法读取文件', description: '请重试或换其它格式', variant: 'destructive' })
        return
      }
      if (valid.length > 0) {
        setAttachments((prev) => [...prev, ...valid].slice(0, MAX_ATTACH_COUNT))
      }
    } finally {
      setAttachmentLoading(false)
    }
  }

  const insertMention = (agentName: string) => {
    if (!textareaRef.current) return
    const result = insertMentionAtCursor(message, textareaRef.current.selectionStart, agentName)
    setMessage(result.text)
    setChatInput(result.text)
    setShowMentions(false)
    setMentionFilter('')
    setTimeout(() => {
      if (!textareaRef.current) return
      textareaRef.current.setSelectionRange(result.nextCursor, result.nextCursor)
      textareaRef.current.focus()
    }, 0)
  }

  const handleSend = () => {
    if (attachmentLoading) return
    if ((message.trim() || attachments.length > 0) && !isSendingMessage) {
      onSendMessage(
        message.trim(),
        attachments.length > 0 ? attachments : undefined,
        selectedAgent,
        selectedModelRef,
      )
      setMessage('')
      setChatInput('')
      setAttachments([])
      setShowMentions(false)
      setMentionFilter('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }
  
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentions && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionCandidates[mentionIndex].name)
        return
      }
      if (e.key === 'Escape') {
        setShowMentions(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }
  
  const handleInput = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }

  const handleModelSelect = (value: string) => {
    setSelectedModelRef(value)
    try {
      localStorage.setItem(LOCAL_SELECTED_MODEL_KEY, value)
    } catch {
      // ignore persisted model save errors
    }
  }

  return (
    <div className="border-t border-border/50 bg-background/80 backdrop-blur-xl p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto"
      >
        {/* 输入框 */}
        <div className="relative bg-secondary/30 border border-border/50 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          {showMentions && mentionCandidates.length > 0 && (
            <div className="absolute left-2 right-2 bottom-full mb-2 rounded-lg border border-border bg-popover z-20 max-h-44 overflow-auto">
              {mentionCandidates.map((item, idx) => (
                <button
                  key={item.name}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent ${idx === mentionIndex ? 'bg-accent' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertMention(item.name)
                  }}
                >
                  @{item.name}
                  <span className="ml-2 text-xs text-muted-foreground">{item.role}</span>
                </button>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="px-3 pt-3 flex flex-wrap gap-2 border-b border-border/30">
              {attachments.map((att, idx) => (
                <div key={`${att.name}-${idx}`} className="relative rounded border border-border bg-background/60 overflow-hidden">
                  {att.type.startsWith('image/') ? (
                    <img src={att.dataUrl} alt={att.name} className="h-[72px] w-[72px] object-cover" />
                  ) : (
                    <div className="h-[72px] w-[72px] p-2 text-[10px] text-muted-foreground break-all">{att.name}</div>
                  )}
                  <button
                    className="absolute top-1 right-1 h-4 w-4 rounded-full bg-black/60 text-white text-[10px]"
                    onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value)
              setChatInput(e.target.value)
              const mentionQuery = extractMentionQuery(e.target.value, e.target.selectionStart)
              if (mentionQuery !== null) {
                setShowMentions(true)
                setMentionFilter(mentionQuery)
                setMentionIndex(0)
              } else {
                setShowMentions(false)
              }
            }}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="可以描述任务或提问任何问题"
            className="min-h-[60px] max-h-[200px] resize-none border-0 bg-transparent px-4 py-3 focus-visible:ring-0 focus-visible:ring-offset-0"
            disabled={isSendingMessage || attachmentLoading}
          />
          
          {/* 底部工具栏 */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border/30">
            <div className="flex items-center gap-2">
              {/* 模型选择器（ModelPicker + zustand，与 mc-selected-model 兼容） */}
              <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                <PopoverAnchor asChild>
                  <div ref={modelTriggerRef} className="inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 min-w-[8.5rem] max-w-[min(280px,55vw)] grid grid-cols-[1.125rem_minmax(0,1fr)_1.125rem] items-center gap-x-2 px-2 py-0 font-normal text-muted-foreground hover:text-foreground has-[>svg]:px-2 [&>svg]:!size-4"
                      onClick={() => setModelPickerOpen((v) => !v)}
                    >
                      <Brain className="size-4 opacity-90" aria-hidden />
                      <span className="min-w-0 truncate text-left text-sm leading-none">{selectedModelLabel}</span>
                      <ChevronDown
                        className={`size-4 justify-self-end opacity-70 transition-transform ${modelPickerOpen ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </Button>
                  </div>
                </PopoverAnchor>
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={8}
                  collisionPadding={12}
                  className="border-0 bg-transparent p-0 shadow-none"
                >
                  <ModelPicker
                    onClose={() => setModelPickerOpen(false)}
                    gatewayOptions={chatModelOptions}
                    selectedRef={selectedModelRef}
                    onSelectRef={handleModelSelect}
                  />
                </PopoverContent>
              </Popover>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-muted-foreground hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSendingMessage || attachmentLoading}
              >
                <Paperclip className="h-4 w-4 mr-1" />
                {attachmentLoading ? '读取中…' : '附件'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const input = e.target as HTMLInputElement
                  // 必须先快照 File[]：清空 value 后部分浏览器会清空 live FileList，导致长度为 0
                  const files = input.files ? Array.from(input.files) : []
                  input.value = ''
                  if (files.length > 0) void addFilesFromList(files)
                }}
              />
            </div>
            
            {/* 发送按钮 */}
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                type="button"
                size="icon"
                className={`h-8 w-8 rounded-lg ${showStopButton ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-primary hover:bg-primary/90'}`}
                onClick={() => {
                  if (showStopButton) {
                    onStopGenerating?.()
                    return
                  }
                  handleSend()
                }}
                disabled={
                  showStopButton
                    ? false
                    : (!message.trim() && attachments.length === 0) ||
                      isSendingMessage ||
                      attachmentLoading
                }
              >
                {showStopButton ? <Square className="h-3.5 w-3.5" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </motion.div>
          </div>
        </div>
        
        {/* Token 用量（仅 gw: 会话） */}
        {activeConversation?.startsWith('gw:') && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {tokenUsageLoading ? (
              <span>正在读取 Token 用量…</span>
            ) : tokenUsage ? (
              <>
                <span className="min-w-0">
                  已消耗{' '}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatTokenShort(tokenUsage.used)}
                  </span>{' '}
                  tokens · 上下文上限{' '}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatTokenShort(tokenUsage.contextLimit)}
                  </span>
                </span>
                {tokenUsage.pct != null ? (
                  <span className="shrink-0 tabular-nums text-muted-foreground">约 {tokenUsage.pct}%</span>
                ) : null}
              </>
            ) : (
              <span>暂无网关用量（会话未写入本地 store 或尚未同步）</span>
            )}
          </div>
        )}

        {/* 底部提示 */}
        <p className="text-center text-xs text-muted-foreground mt-3">
          {showStopButton
            ? '进行中：可点右侧停止按钮停止生成'
            : '内容由AI生成，请仔细甄别'}
        </p>
      </motion.div>

    </div>
  )
}
