'use client'

import { useState, useRef, KeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown, Brain, Sparkles, ArrowUp } from 'lucide-react'
import { useXClawStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface MessageInputProps {
  onSendMessage: (content: string) => void
}

const models = ['default', 'gpt-4', 'claude-3', 'gemini-pro']
const agents = ['虾灵感', '通用助手', '代码专家', '写作助手']

export function MessageInput({ onSendMessage }: MessageInputProps) {
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { isSendingMessage, setChatInput } = useXClawStore()
  const [selectedModel, setSelectedModel] = useState(models[0])
  const [selectedAgent, setSelectedAgent] = useState(agents[0])
  
  const handleSend = () => {
    if (message.trim() && !isSendingMessage) {
      onSendMessage(message.trim())
      setMessage('')
      setChatInput('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    }
  }
  
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
  
  return (
    <div className="border-t border-border/50 bg-background/80 backdrop-blur-xl p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl mx-auto"
      >
        {/* 输入框 */}
        <div className="relative bg-secondary/30 border border-border/50 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-primary/20 transition-all">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value)
              setChatInput(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="可以描述任务或提问任何问题"
            className="min-h-[60px] max-h-[200px] resize-none border-0 bg-transparent px-4 py-3 focus-visible:ring-0 focus-visible:ring-offset-0"
            disabled={isSendingMessage}
          />
          
          {/* 底部工具栏 */}
          <div className="flex items-center justify-between px-3 py-2 border-t border-border/30">
            <div className="flex items-center gap-2">
              {/* 模型选择器 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground">
                    <Brain className="h-4 w-4 mr-2" />
                    {selectedModel}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {models.map((model) => (
                    <DropdownMenuItem
                      key={model}
                      onClick={() => setSelectedModel(model)}
                      className={model === selectedModel ? 'bg-accent' : ''}
                    >
                      {model}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              
              {/* 智能体选择器 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground">
                    <Sparkles className="h-4 w-4 mr-2" />
                    {selectedAgent}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {agents.map((agent) => (
                    <DropdownMenuItem
                      key={agent}
                      onClick={() => setSelectedAgent(agent)}
                      className={agent === selectedAgent ? 'bg-accent' : ''}
                    >
                      {agent}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
            {/* 发送按钮 */}
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                size="icon"
                className="h-8 w-8 rounded-lg bg-primary hover:bg-primary/90"
                onClick={handleSend}
                disabled={!message.trim() || isSendingMessage}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </motion.div>
          </div>
        </div>
        
        {/* 底部提示 */}
        <p className="text-center text-xs text-muted-foreground mt-3">
          内容由AI生成，请仔细甄别
        </p>
      </motion.div>
    </div>
  )
}
