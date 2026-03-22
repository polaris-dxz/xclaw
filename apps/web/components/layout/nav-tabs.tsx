'use client'

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface NavTabsProps {
  tabs?: Array<{ id: string; label: string }>
  activeTab?: string
  onTabChange: (tab: string) => void
  variant?: 'default' | 'studio'
}

export function NavTabs({ tabs = [], activeTab = '', onTabChange, variant = 'default' }: NavTabsProps) {
  const safeTabs = Array.isArray(tabs) ? tabs : []
  const activeIndex = Math.max(
    0,
    safeTabs.findIndex((tab) => tab.id === activeTab)
  )

  const studio = variant === 'studio'

  return (
    <div
      className={cn(
        'relative flex items-center rounded-lg p-1',
        studio ? 'bg-[#151522]/90' : 'bg-secondary/50',
      )}
    >
      <motion.div
        className={cn(
          'absolute h-[calc(100%-8px)] rounded-md shadow-sm',
          studio ? 'bg-[#2a2a45]' : 'bg-background',
        )}
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
            activeTab === tab.id
              ? studio
                ? 'text-slate-100'
                : 'text-foreground'
              : studio
                ? 'text-slate-500 hover:text-slate-200'
                : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
