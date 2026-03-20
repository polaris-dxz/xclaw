'use client'

import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import { Moon, Sun, MessageSquarePlus } from 'lucide-react'
import { NavTabs } from './nav-tabs'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface AppHeaderProps {
  tabs: Array<{ id: string; label: string }>
  activeTab: string
  onTabChange: (tab: string) => void
  onNewChat: () => void
}

export function AppHeader({ tabs, activeTab, onTabChange, onNewChat }: AppHeaderProps) {
  const { theme, setTheme } = useTheme()
  
  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      {/* 左侧：主题切换 + 新建对话 */}
      <div className="flex items-center gap-4">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                <motion.div
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', bounce: 0.3 }}
                  key={theme}
                >
                  {theme === 'dark' ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Moon className="h-4 w-4" />
                  )}
                </motion.div>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              <p>切换主题</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onNewChat}
              >
                <MessageSquarePlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={8}>
              <p>新建对话</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      
      {/* 中间：导航标签 */}
      <div className="absolute left-1/2 -translate-x-1/2">
        <NavTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
      </div>
      
      {/* 右侧：版本号 + 反馈 */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>v0.1.13</span>
        <Button variant="ghost" size="sm" className="h-8 text-muted-foreground hover:text-foreground">
          <MessageSquarePlus className="h-4 w-4 mr-1.5" />
          问题反馈
        </Button>
      </div>
    </header>
  )
}
