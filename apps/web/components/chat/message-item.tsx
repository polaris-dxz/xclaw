'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { ThumbsUp, ThumbsDown, ChevronDown, Calendar, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { type ChatMessage, useXClawStore } from '@/store'

interface MessageItemProps {
  message: ChatMessage
  conversationId: string
}

export function MessageItem({ message, conversationId }: MessageItemProps) {
  const { updatePendingMessage } = useXClawStore()
  const metadata = (message.metadata || {}) as Record<string, any>
  const isUser = message.from_agent !== 'assistant' && message.from_agent !== 'coordinator'
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(
        'py-4',
        isUser ? 'flex justify-end' : ''
      )}
    >
      {isUser ? (
        /* 用户消息 - 右对齐，带背景 */
        <div className="max-w-[80%] bg-secondary/80 rounded-2xl px-4 py-3">
          <p className="text-sm leading-relaxed">{message.content}</p>
        </div>
      ) : (
        /* AI 消息 - 左对齐，无背景 */
        <div className="space-y-3">
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
          
          {/* 消息内容 */}
          <div className={cn(
            'prose prose-sm dark:prose-invert max-w-none',
            message.pendingStatus === 'sending' && 'typing-cursor'
          )}>
            {message.content.split('\n').map((line, i) => {
              // 处理标题
              if (line.startsWith('**') && line.endsWith('**')) {
                return (
                  <h4 key={i} className="font-semibold mt-4 mb-2 first:mt-0">
                    {line.replace(/\*\*/g, '')}
                  </h4>
                )
              }
              // 处理列表项
              if (line.startsWith('- ')) {
                const content = line.slice(2)
                // 检查是否包含日历图标
                const hasCalendar = content.includes('【') && content.includes('】')
                return (
                  <div key={i} className="flex items-start gap-2 py-1">
                    <span className="text-primary mt-0.5">
                      {hasCalendar ? <Calendar className="h-4 w-4" /> : '•'}
                    </span>
                    <span>{content}</span>
                  </div>
                )
              }
              // 普通段落
              if (line.trim()) {
                return <p key={i} className="my-2">{line}</p>
              }
              return null
            })}
          </div>
          
          {/* 工具卡片（如 Apple 日历） */}
          {message.content.includes('日程') && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.3 }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-lg shadow-sm"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-white" />
              </div>
              <span className="text-sm font-medium">Apple 日历</span>
            </motion.div>
          )}
          
          {/* 反馈按钮 */}
          <div className="flex items-center gap-1 mt-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <ThumbsUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
              <ThumbsDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  )
}
