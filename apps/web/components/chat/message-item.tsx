'use client'

import { useCallback, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  CheckCircle2,
  Wrench,
  Loader2,
  User,
  Bot,
  Copy,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { type ChatMessage, useXClawStore } from '@/store'
import { hydrateMessageAttachmentsFromMetadata } from '@/lib/chat-sync'
import { mergeUserFeedbackMetadata } from '@/lib/chat-message-feedback'
import { MarkdownContent } from './markdown-content'
import {
  isUserChatMessage,
  looksLikeGatewayToolProcessJson,
  stripInlinedAttachmentPreviewFromUserContent,
  stripOpenClawAssistantFooter,
} from './chat-helpers'
import { toast } from '@/hooks/use-toast'
import type { JsonValue } from '@/store'

/** 与 MarkdownContent 配套：抵消 typography 对 hr 等的负 margin，保证与正文左缘对齐 */
const proseChat =
  'prose prose-sm dark:prose-invert max-w-none w-full min-w-0 [&_hr]:mx-0 [&_hr]:w-full [&_blockquote]:mx-0'

interface MessageItemProps {
  message: ChatMessage
  conversationId: string
}

export function MessageItem({ message, conversationId: _conversationId }: MessageItemProps) {
  const [processExpanded, setProcessExpanded] = useState(true)
  const [toolExpanded, setToolExpanded] = useState(true)
  const [dislikeOpen, setDislikeOpen] = useState(false)
  const [dislikeReason, setDislikeReason] = useState('')
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const { updatePendingMessage, currentUser } = useXClawStore()
  const metadata = (message.metadata || {}) as Record<string, any>
  const isUser = isUserChatMessage(message, currentUser)
  const status = String(metadata.status || '').toLowerCase()
  const phase = String(metadata.phase || '').toLowerCase()
  const isToolCall = message.message_type === 'tool_call' || metadata.event === 'tool_call'
  const role = String(metadata.role || '').toLowerCase()
  const isThinkingStatus =
    message.message_type === 'status' && (status === 'accepted' || status === 'processing') && (phase === 'thinking' || !phase)
  /** Gateway 常为 text + role=assistant，phase 可能为空或误标为 thinking */
  const isFinalText =
    message.message_type === 'text' &&
    !isToolCall &&
    !looksLikeGatewayToolProcessJson(message.content) &&
    (role === 'assistant' || phase === 'final' || phase === '')
  const isErrorBubble = phase === 'error' && message.message_type === 'status'
  const isFinalStatus = phase === 'final' && message.message_type === 'status'
  const rawContent = String(message.content ?? '')
  /** 用户气泡：不展示服务端内联的附件全文，仅展示输入文字 + 下方附件区 */
  const userDisplayContent = isUser ? stripInlinedAttachmentPreviewFromUserContent(rawContent) : rawContent
  /** 剥离 OpenClaw 末尾会话元信息块，避免占满主气泡 */
  const assistantDisplay = isUser ? userDisplayContent : stripOpenClawAssistantFooter(rawContent)
  const showFeedback = Boolean(
    !isUser &&
      isFinalText &&
      assistantDisplay.trim().length > 0 &&
      (role === 'assistant' || phase === 'final' || phase === ''),
  )
  const userFeedback =
    metadata.userFeedback === 'up' || metadata.userFeedback === 'down' ? metadata.userFeedback : null

  const patchMessageFeedback = useCallback(
    async (patch: { feedback: 'up' | 'down' | null; feedbackReason?: string }) => {
      if (message.id <= 0) {
        toast({ title: '请待消息同步后再评价', variant: 'destructive' })
        return
      }
      const prevSnapshot = { ...(metadata as Record<string, unknown>) }
      const optimistic = mergeUserFeedbackMetadata(metadata as Record<string, unknown>, patch)
      updatePendingMessage(message.id, { metadata: optimistic as JsonValue })
      setFeedbackBusy(true)
      try {
        const res = await fetch(`/api/chat/messages/${message.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feedback: patch.feedback,
            ...(patch.feedback === 'down' ? { feedbackReason: patch.feedbackReason } : {}),
          }),
        })
        const data = (await res.json()) as { message?: ChatMessage; error?: string }
        if (!res.ok) {
          updatePendingMessage(message.id, { metadata: prevSnapshot as JsonValue })
          toast({ title: data.error || '保存失败', variant: 'destructive' })
          return
        }
        if (data.message?.metadata !== undefined) {
          updatePendingMessage(message.id, { metadata: data.message.metadata })
        }
      } catch {
        updatePendingMessage(message.id, { metadata: prevSnapshot as JsonValue })
        toast({ title: '网络错误', variant: 'destructive' })
      } finally {
        setFeedbackBusy(false)
      }
    },
    [message.id, message.metadata, updatePendingMessage],
  )
  /** 有「已完成思考」等区块时头像与首块顶对齐；仅正文时用首行中线与 h-9 头像对齐 */
  const hasAssistantThinkingUi =
    typeof metadata.thinkingContent === 'string' && metadata.thinkingContent.trim().length > 0
  /** 顶层 attachments 与 metadata.attachments 二选一（GET/SSE 可能只带其一） */
  const userAttachments = isUser ? hydrateMessageAttachmentsFromMetadata(message).attachments : undefined

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="py-4"
    >
      {isUser ? (
        /* 用户消息：右侧气泡 + 用户头像，模拟对话 */
        <div className="flex w-full items-end justify-end gap-2">
          <div className="max-w-[min(80%,28rem)] rounded-2xl bg-secondary/80 px-4 py-3">
            {userDisplayContent.trim().length > 0 ? (
              <div className={proseChat}>
                <MarkdownContent>{userDisplayContent}</MarkdownContent>
              </div>
            ) : null}
            {Array.isArray(userAttachments) && userAttachments.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {userAttachments.map((att, idx) => (
                  <div key={`${att.name}-${idx}`} className="rounded border border-border bg-background/60 p-1">
                    {att.type.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={att.dataUrl} alt={att.name} className="h-16 w-16 object-cover rounded" />
                    ) : (
                      <span className="text-xs text-muted-foreground">{att.name}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <Avatar className="h-9 w-9 shrink-0 border border-border/60">
            {currentUser?.avatar_url ? (
              <AvatarImage src={currentUser.avatar_url} alt="" />
            ) : null}
            <AvatarFallback className="bg-primary/15 text-primary">
              <User className="h-4 w-4" />
            </AvatarFallback>
          </Avatar>
        </div>
      ) : (
        /* 助手消息：助手头像 + 内容区 */
        <div className="flex w-full items-start gap-2">
          <Avatar className="h-9 w-9 shrink-0 border border-border/60">
            <AvatarFallback className="bg-muted">
              <Bot className="h-4 w-4 text-muted-foreground" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-3 [&_.markdown-body>:first-child]:mt-0">
          {/* 思考状态 */}
          {typeof metadata.thinkingContent === 'string' && metadata.thinkingContent && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="flex items-start gap-2"
            >
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  updatePendingMessage(message.id, {
                    metadata: {
                      ...metadata,
                      thinkingExpanded: !metadata.thinkingExpanded,
                    },
                  })
                }
              >
                <CheckCircle2 className="h-4 w-4 mr-2 text-primary" />
                已完成思考
                <motion.div
                  animate={{ rotate: metadata.thinkingExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="h-4 w-4 ml-1" />
                </motion.div>
              </Button>
            </motion.div>
          )}
          
          {/* 思考内容展开 */}
          <AnimatePresence>
            {metadata.thinkingExpanded && typeof metadata.thinkingContent === 'string' && metadata.thinkingContent && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="pl-4 border-l-2 border-primary/30 text-sm text-muted-foreground"
              >
                {metadata.thinkingContent}
              </motion.div>
            )}
          </AnimatePresence>
          
          {/* 工具调用可视化（思考过程） */}
          {isToolCall ? (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setToolExpanded((v) => !v)}
                className="flex w-full max-w-xl items-center gap-2 rounded-md py-1.5 text-left hover:bg-muted/40"
              >
                <motion.span animate={{ rotate: toolExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </motion.span>
                <span className="text-sm font-medium">工具调用</span>
                <span className="text-xs text-muted-foreground">中间步骤，可折叠</span>
              </button>
              <AnimatePresence initial={false}>
                {toolExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-lg border border-dashed border-border/80 bg-muted/15 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Wrench className="h-4 w-4 text-primary" />
                        <span>{String(metadata.toolName || message.content || 'Tool Call')}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        状态：{String(metadata.status || 'running')}
                      </div>
                      {typeof metadata.input === 'string' && metadata.input && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">输入参数</summary>
                          <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2">{metadata.input}</pre>
                        </details>
                      )}
                      {typeof metadata.output === 'string' && metadata.output && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">输出结果</summary>
                          <pre className="mt-2 whitespace-pre-wrap rounded bg-muted/50 p-2">{metadata.output}</pre>
                        </details>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : isErrorBubble ? (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-destructive/80 font-medium">错误</div>
              <div className={cn('rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2', proseChat)}>
                <MarkdownContent>{assistantDisplay}</MarkdownContent>
              </div>
            </div>
          ) : isFinalText ? (
            <div className="space-y-1">
              <div
                className={cn(
                  proseChat,
                  message.pendingStatus === 'sending' && 'typing-cursor',
                  !hasAssistantThinkingUi && 'pt-[calc((2.25rem-1lh)/2)]'
                )}
              >
                {assistantDisplay.trim() ? <MarkdownContent>{assistantDisplay}</MarkdownContent> : null}
              </div>
            </div>
          ) : (
            <div className="space-y-1 max-w-xl">
              <button
                type="button"
                onClick={() => setProcessExpanded((v) => !v)}
                className="flex w-full items-start gap-2 rounded-md py-1.5 text-left hover:bg-muted/40"
              >
                <motion.span
                  className="mt-0.5"
                  animate={{ rotate: processExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </motion.span>
                <span className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                  <span className="text-sm font-medium">
                    {isFinalStatus ? '补充说明' : '思考过程'}
                  </span>
                  <span className="text-xs text-muted-foreground font-normal">
                    {isFinalStatus
                      ? '本轮结束时的系统提示（非最终正文）'
                      : '助手在出正式回复前的状态提示，可折叠'}
                  </span>
                </span>
              </button>
              <AnimatePresence initial={false}>
                {processExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 px-3 py-2 space-y-2">
                      {isThinkingStatus && (
                        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>{status === 'accepted' ? '已接收，开始思考' : '正在处理...'}</span>
                        </div>
                      )}
                      <div className={cn(proseChat, 'text-muted-foreground')}>
                        <MarkdownContent>{assistantDisplay}</MarkdownContent>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          
          {/* 反馈：仅对「最终文本回复」展示，避免每条过程消息都出现 */}
          {showFeedback && (
            <>
              <div className="flex items-center gap-1 mt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={feedbackBusy}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="复制回复"
                  aria-label="复制回复"
                  onClick={async () => {
                    const text = assistantDisplay
                    try {
                      await navigator.clipboard.writeText(text)
                      toast({ title: '已复制到剪贴板' })
                    } catch {
                      toast({
                        title: '复制失败',
                        description: '请检查浏览器权限或手动选择文本复制',
                        variant: 'destructive',
                      })
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={feedbackBusy}
                  title={userFeedback === 'up' ? '取消点赞' : '点赞'}
                  aria-label={userFeedback === 'up' ? '取消点赞' : '点赞'}
                  aria-pressed={userFeedback === 'up'}
                  className={cn(
                    'h-8 w-8 text-muted-foreground hover:text-foreground',
                    userFeedback === 'up' && 'text-primary bg-primary/10 hover:text-primary',
                  )}
                  onClick={() => {
                    if (userFeedback === 'up') void patchMessageFeedback({ feedback: null })
                    else void patchMessageFeedback({ feedback: 'up' })
                  }}
                >
                  <ThumbsUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={feedbackBusy}
                  title={userFeedback === 'down' ? '取消点踩' : '点踩'}
                  aria-label={userFeedback === 'down' ? '取消点踩' : '点踩'}
                  aria-pressed={userFeedback === 'down'}
                  className={cn(
                    'h-8 w-8 text-muted-foreground hover:text-foreground',
                    userFeedback === 'down' && 'text-destructive bg-destructive/10 hover:text-destructive',
                  )}
                  onClick={() => {
                    if (userFeedback === 'down') void patchMessageFeedback({ feedback: null })
                    else {
                      setDislikeReason('')
                      setDislikeOpen(true)
                    }
                  }}
                >
                  <ThumbsDown className="h-4 w-4" />
                </Button>
              </div>
              <Dialog open={dislikeOpen} onOpenChange={setDislikeOpen}>
                <DialogContent showCloseButton className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
                  <DialogHeader>
                    <DialogTitle>请说明不满意的原因</DialogTitle>
                    <DialogDescription>你的反馈会保存在该条消息上，便于后续改进。</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2">
                    <Label htmlFor={`dislike-reason-${message.id}`}>原因</Label>
                    <Textarea
                      id={`dislike-reason-${message.id}`}
                      value={dislikeReason}
                      onChange={(e) => setDislikeReason(e.target.value)}
                      placeholder="例如：事实错误、未理解需求、格式混乱…"
                      className="min-h-24"
                      maxLength={5000}
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setDislikeOpen(false)}>
                      取消
                    </Button>
                    <Button
                      type="button"
                      disabled={feedbackBusy || !dislikeReason.trim()}
                      onClick={() => {
                        const r = dislikeReason.trim()
                        if (!r) {
                          toast({ title: '请填写原因', variant: 'destructive' })
                          return
                        }
                        void patchMessageFeedback({ feedback: 'down', feedbackReason: r }).then(() =>
                          setDislikeOpen(false),
                        )
                      }}
                    >
                      提交点踩
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
          </div>
        </div>
      )}
    </motion.div>
  )
}
