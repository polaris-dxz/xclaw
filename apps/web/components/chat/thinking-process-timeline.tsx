'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  FileText,
  Loader2,
  Puzzle,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { type ChatMessage, useXClawStore } from '@/store'
import { MarkdownContent } from './markdown-content'
import {
  extractLeadingJsonObject,
  isUserChatMessage,
  looksLikeGatewayToolProcessJson,
} from './chat-helpers'
import { stripUntrustedSenderMetadataEnvelope } from '@/lib/chat-messages/untrusted-sender-envelope'

function summarizeProcessJson(content: string): { title: string; detail: string } {
  const raw = extractLeadingJsonObject(content)
  if (!raw) return { title: '工具输出', detail: content.slice(0, 200) }
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (typeof o.tool === 'string' && o.status === 'error') {
      return {
        title: `${o.tool} · 失败`,
        detail: String(o.error || '').slice(0, 240) + (String(o.error || '').length > 240 ? '…' : ''),
      }
    }
    const err = String(o.error || 'error')
    const msg = String(o.message || '')
    return { title: err, detail: msg.slice(0, 280) + (msg.length > 280 ? '…' : '') }
  } catch {
    return { title: '工具输出', detail: content.slice(0, 200) }
  }
}

function StepTitle({ message }: { message: ChatMessage }) {
  const meta = (message.metadata || {}) as Record<string, unknown>
  const status = String(meta.status || '').toLowerCase()

  if (message.message_type === 'tool_call' || meta.event === 'tool_call') {
    return (
      <span className="text-sm">
        工具 ·{' '}
        <span className="font-medium text-foreground">{String(meta.toolName || message.content || 'call')}</span>
      </span>
    )
  }

  if (message.message_type === 'status') {
    if (status === 'accepted') return <span className="text-sm">已接收请求</span>
    if (status === 'processing') return <span className="text-sm">仍在处理…</span>
    return <span className="text-sm text-muted-foreground line-clamp-2">{message.content.slice(0, 120)}</span>
  }

  if (message.message_type === 'text' && looksLikeGatewayToolProcessJson(message.content)) {
    const { title, detail } = summarizeProcessJson(message.content)
    return (
      <span className="text-sm">
        <span className="font-medium text-amber-600 dark:text-amber-400">{title}</span>
        {detail ? <span className="block text-xs text-muted-foreground mt-0.5">{detail}</span> : null}
      </span>
    )
  }

  const processBody = stripUntrustedSenderMetadataEnvelope(message.content)
  return (
    <div className="max-w-full">
      <MarkdownContent tone="muted">{processBody}</MarkdownContent>
    </div>
  )
}

function StepIcon({ message }: { message: ChatMessage }) {
  const meta = (message.metadata || {}) as Record<string, unknown>
  const status = String(meta.status || '').toLowerCase()

  if (message.message_type === 'tool_call' || meta.event === 'tool_call') {
    return <Wrench className="h-3.5 w-3.5 text-primary shrink-0" />
  }
  if (message.message_type === 'text' && looksLikeGatewayToolProcessJson(message.content)) {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
  }
  if (message.message_type === 'status' && (status === 'accepted' || status === 'processing')) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
  }
  if (message.content.includes('http') && message.content.length < 400) {
    return <Puzzle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  }
  if (message.content.toLowerCase().includes('.md') || message.content.includes('查看')) {
    return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  }
  return <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

export function ThinkingProcessTimeline({ messages }: { messages: ChatMessage[] }) {
  const [open, setOpen] = useState(true)
  const { currentUser } = useXClawStore()

  if (messages.length === 0) return null

  const visible = messages.filter((message) => !isUserChatMessage(message, currentUser))

  if (visible.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex w-full items-start gap-2 py-3"
    >
      <Avatar className="h-9 w-9 shrink-0 self-start border border-border/60">
        <AvatarFallback className="bg-muted">
          <Bot className="h-4 w-4 text-muted-foreground" />
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 max-w-xl">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left hover:bg-muted/35"
        >
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </motion.span>
          <span className="text-sm font-medium">思考过程</span>
          <span className="text-xs text-muted-foreground">· {visible.length} 步 · 非最终回答</span>
        </button>

        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-0">
                {visible.map((message, idx) => {
                  const meta = (message.metadata || {}) as Record<string, unknown>
                  const isLast = idx === visible.length - 1
                  return (
                    <div key={message.id} className="flex gap-3">
                      <div className="flex w-9 shrink-0 flex-col items-center">
                        <div
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/40 text-muted-foreground shadow-sm',
                            message.message_type === 'text' &&
                              looksLikeGatewayToolProcessJson(message.content) &&
                              'border-amber-500/35 bg-amber-500/[0.08]'
                          )}
                        >
                          <StepIcon message={message} />
                        </div>
                        {!isLast ? (
                          <div
                            className="w-px flex-1 min-h-[1rem] bg-border/60"
                            aria-hidden
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 space-y-1 pb-5 last:pb-0">
                        <StepTitle message={message} />
                        {message.message_type === 'tool_call' &&
                          typeof meta.input === 'string' &&
                          meta.input.length > 0 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground">参数</summary>
                              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-[11px]">
                                {meta.input}
                              </pre>
                            </details>
                          )}
                        {message.message_type === 'tool_call' &&
                          typeof meta.output === 'string' &&
                          meta.output.length > 0 && (
                            <details className="text-xs">
                              <summary className="cursor-pointer text-muted-foreground">输出</summary>
                              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-[11px]">
                                {meta.output}
                              </pre>
                            </details>
                          )}
                        {message.message_type === 'text' &&
                          looksLikeGatewayToolProcessJson(message.content) && (
                            <details className="mt-1 text-xs">
                              <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                                完整 JSON
                              </summary>
                              <pre className="mt-2 max-h-40 overflow-auto rounded border border-amber-500/20 bg-amber-500/[0.06] p-2 text-[11px] leading-relaxed text-muted-foreground">
                                {message.content}
                              </pre>
                            </details>
                          )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
