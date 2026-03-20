'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Sparkles, Clock, Settings, User, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useXClawStore, type Conversation } from '@/store'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import Link from 'next/link'

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

export function ChatSidebar() {
  const { conversations, activeConversation, setActiveConversation, setConversations } = useXClawStore()
  const [remoteConversations, setRemoteConversations] = useState<any[]>([])
  const [loadingRemote, setLoadingRemote] = useState(false)

  const loadRemote = async () => {
    setLoadingRemote(true)
    try {
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

  useEffect(() => {
    void loadRemote()
  }, [])

  useEffect(() => {
    if (remoteConversations.length === 0) return
    const mapped: Conversation[] = remoteConversations.map((item) => ({
      id: item.conversation_id,
      name: item.last_message?.content?.slice(0, 40) || item.conversation_id,
      participants: [],
      unreadCount: Number(item.unread_count || 0),
      updatedAt: Number(item.last_message_at || Math.floor(Date.now() / 1000)),
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
    }))
    setConversations(mapped)
    if (!activeConversation && mapped[0]?.id) {
      setActiveConversation(mapped[0].id)
    }
  }, [remoteConversations, setConversations, activeConversation, setActiveConversation])

  const mergedConversations = useMemo(() => {
    return conversations.map((conv) => ({
      ...conv,
      name: conv.name || conv.id,
    }))
  }, [conversations, remoteConversations])

  const groups = groupConversationsByDate(mergedConversations)

  const handleSelectConversation = (conv: Conversation) => {
    setActiveConversation(conv.id)
  }
  
  return (
    <div className="w-72 h-full flex flex-col border-r border-border/50 bg-sidebar">
      {/* 搜索框 */}
      <div className="p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索"
              className="pl-9 bg-secondary/50 border-0 focus-visible:ring-1"
            />
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={() => void loadRemote()}
            disabled={loadingRemote}
          >
            <RefreshCw className={cn('h-4 w-4', loadingRemote && 'animate-spin')} />
          </Button>
        </div>
      </div>
      
      {/* 对话列表 */}
      <ScrollArea className="flex-1 px-2">
        <AnimatePresence mode="wait">
          {groups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                {group.label}
              </div>
              {group.conversations.map((conv, index) => (
                <motion.button
                  key={conv.id}
                  custom={index}
                  variants={listItemVariants}
                  initial="hidden"
                  animate="visible"
                  onClick={() => handleSelectConversation(conv)}
                  className={cn(
                    'w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors',
                    'hover:bg-sidebar-accent',
                    activeConversation === conv.id
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground'
                  )}
                >
                  <div className="text-sm font-medium truncate">{conv.name || conv.id}</div>
                </motion.button>
              ))}
            </div>
          ))}
        </AnimatePresence>
      </ScrollArea>
      
      {/* 底部快捷入口 */}
      <div className="p-2 border-t border-border/50">
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button variant="ghost" className="w-full justify-start gap-3 h-10">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>灵感广场</span>
          </Button>
        </motion.div>
        
        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Button variant="ghost" className="w-full justify-start gap-3 h-10">
            <Clock className="h-4 w-4" />
            <span>定时任务</span>
          </Button>
        </motion.div>
        
        {/* 用户信息和设置 */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarImage src="/avatar.png" />
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                <User className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
          </div>
          
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
              <div className="h-4 w-4 rounded border-2 border-current" />
            </Button>
            <Link href="/settings">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
