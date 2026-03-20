'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface NavTabsProps {
  tabs?: Array<{ id: string; label: string }>
  activeTab?: string
  onTabChange: (tab: string) => void
}

export function NavTabs({ tabs = [], activeTab = '', onTabChange }: NavTabsProps) {
  const safeTabs = Array.isArray(tabs) ? tabs : []
  const activeIndex = Math.max(
    0,
    safeTabs.findIndex((tab) => tab.id === activeTab)
  )

  return (
    <div className="relative flex items-center bg-secondary/50 rounded-lg p-1">
      <motion.div
        className="absolute h-[calc(100%-8px)] bg-background rounded-md shadow-sm"
        layoutId="nav-tab-indicator"
        initial={false}
        animate={{
          x: `${activeIndex * 100}%`,
          width: `${100 / Math.max(1, safeTabs.length)}%`,
        }}
        transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
      />
      {safeTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'relative z-10 px-4 py-1.5 text-sm font-medium transition-colors min-w-[72px]',
            activeTab === tab.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
