'use client'

import { useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageItem } from './message-item'
import { MessageInput } from './message-input'
import { useXClawStore, type ChatMessage } from '@/store'
import { ScrollArea } from '@/components/ui/scroll-area'

export function ChatPanel() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { 
    conversations,
    activeConversation,
    chatMessages,
    setChatMessages,
    addChatMessage,
    replacePendingMessage,
    updatePendingMessage,
    removePendingMessage,
    setIsSendingMessage,
  } = useXClawStore()
  
  const selectedConversation = conversations.find((c) => c.id === activeConversation)
  const selectedMessages = chatMessages
    .filter((msg) => msg.conversation_id === activeConversation)
    .sort((a, b) => a.created_at - b.created_at)
  
  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [selectedMessages.length, activeConversation])

  useEffect(() => {
    if (!activeConversation) return
    let cancelled = false
    const loadMessages = async () => {
      try {
        const response = await fetch(
          `/api/chat/messages?conversation_id=${encodeURIComponent(activeConversation)}&limit=200`,
          { cache: 'no-store' }
        )
        const data = await response.json()
        if (!response.ok || cancelled) return
        const incoming = (Array.isArray(data.messages) ? data.messages : []) as ChatMessage[]
        setChatMessages(
          [
            ...chatMessages.filter((msg) => msg.conversation_id !== activeConversation),
            ...incoming,
          ].sort((a, b) => a.created_at - b.created_at)
        )
      } catch {
        // keep existing cached messages on fetch failures
      }
    }
    void loadMessages()
    return () => {
      cancelled = true
    }
  }, [activeConversation, setChatMessages])
  
  const handleSendMessage = async (content: string) => {
    if (!activeConversation) return

    const tempId = -Date.now()
    const pendingMessage: ChatMessage = {
      id: tempId,
      conversation_id: activeConversation,
      from_agent: 'you',
      to_agent: null,
      content,
      message_type: 'text',
      created_at: Math.floor(Date.now() / 1000),
      pendingStatus: 'sending',
    }

    addChatMessage(pendingMessage)
    setIsSendingMessage(true)
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: activeConversation,
          content,
          message_type: 'text',
          forward: true,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        updatePendingMessage(tempId, { pendingStatus: 'failed' })
        return
      }
      if (data?.message) {
        replacePendingMessage(tempId, data.message as ChatMessage)
      } else {
        removePendingMessage(tempId)
      }
    } catch {
      updatePendingMessage(tempId, { pendingStatus: 'failed' })
    } finally {
      setIsSendingMessage(false)
    }
  }
  
  if (!selectedConversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center text-muted-foreground"
        >
          <p className="text-lg font-medium">选择一个对话开始</p>
          <p className="text-sm mt-1">或创建新的对话</p>
        </motion.div>
      </div>
    )
  }
  
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* 消息列表 */}
      <ScrollArea className="flex-1 px-6" ref={scrollRef}>
        <div className="max-w-4xl mx-auto py-6">
          <AnimatePresence mode="popLayout">
            {selectedMessages.map((message) => (
              <MessageItem 
                key={message.id} 
                message={message} 
                conversationId={selectedConversation.id}
              />
            ))}
          </AnimatePresence>
        </div>
      </ScrollArea>
      
      {/* 输入框 */}
      <MessageInput onSendMessage={handleSendMessage} />
    </div>
  )
}
