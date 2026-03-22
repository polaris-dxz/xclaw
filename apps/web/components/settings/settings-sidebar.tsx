'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { 
  LayoutGrid,
  Bot,
  ListTodo,
  MessageSquare,
  Radio,
  Zap,
  Brain,
  Activity,
  FileText,
  DollarSign,
  Server,
  ClipboardCheck,
  Building2,
  Monitor,
  Clock,
  Webhook,
  Bell,
  Github,
  Shield,
  Users,
  FileSearch,
  Network,
  Puzzle,
  Bug,
  Settings,
  ChevronDown,
} from 'lucide-react'
import { useState } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface MenuItem {
  icon: React.ComponentType<{ className?: string }>
  label: string
  href: string
}

interface MenuGroup {
  label: string
  items: MenuItem[]
  defaultOpen?: boolean
}

const menuGroups: MenuGroup[] = [
  {
    label: '',
    defaultOpen: true,
    items: [
      { icon: LayoutGrid, label: '概览', href: '/settings' },
      { icon: Bot, label: '智能体', href: '/settings/agents' },
      { icon: ListTodo, label: '任务', href: '/settings/tasks' },
      { icon: MessageSquare, label: '聊天', href: '/settings/chats' },
      { icon: Radio, label: '频道', href: '/settings/channels' },
      { icon: Zap, label: '技能广场', href: '/settings/skills' },
      { icon: Brain, label: '记忆', href: '/settings/memory' },
    ],
  },
  {
    label: '监控',
    defaultOpen: true,
    items: [
      { icon: Activity, label: '活动', href: '/settings/monitoring/activity' },
      { icon: FileText, label: '日志', href: '/settings/monitoring/logs' },
      { icon: DollarSign, label: '费用追踪', href: '/settings/monitoring/costs' },
      { icon: Server, label: '节点', href: '/settings/monitoring/nodes' },
      { icon: ClipboardCheck, label: '审批', href: '/settings/monitoring/approval' },
      { icon: Building2, label: '办公室', href: '/settings/monitoring/office' },
      { icon: Monitor, label: 'Monitor', href: '/settings/monitoring/monitor' },
    ],
  },
  {
    label: '自动化',
    defaultOpen: true,
    items: [
      { icon: Clock, label: 'Cron', href: '/settings/automation/cron' },
      { icon: Webhook, label: 'Webhooks', href: '/settings/automation/webhooks' },
      { icon: Bell, label: '告警', href: '/settings/automation/alerts' },
      { icon: Github, label: 'GitHub', href: '/settings/automation/github' },
    ],
  },
  {
    label: '管理',
    defaultOpen: true,
    items: [
      { icon: Shield, label: '安全', href: '/settings/management/security' },
      { icon: Users, label: '用户', href: '/settings/management/users' },
      { icon: FileSearch, label: '审计', href: '/settings/management/audit' },
      { icon: Network, label: '网关', href: '/settings/management/gateway' },
      { icon: Brain, label: '模型', href: '/settings/management/models' },
      { icon: Puzzle, label: '集成', href: '/settings/management/integrations' },
      { icon: Bug, label: '调试', href: '/settings/management/debug' },
      { icon: Settings, label: '设置', href: '/settings/management/settings' },
    ],
  },
]

const itemVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: {
      delay: i * 0.03,
      duration: 0.2,
    },
  }),
}

export function SettingsSidebar() {
  const pathname = usePathname()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    menuGroups.reduce((acc, group) => ({ ...acc, [group.label]: group.defaultOpen ?? true }), {})
  )
  
  const toggleGroup = (label: string) => {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }))
  }
  
  return (
    <div className="flex h-full min-h-0 w-56 shrink-0 flex-col border-r border-border/50 bg-sidebar">
      <ScrollArea className="h-full min-h-0 flex-1 py-4">
        {menuGroups.map((group, groupIndex) => (
          <div key={group.label || 'main'} className="mb-2">
            {group.label ? (
              <Collapsible
                open={openGroups[group.label]}
                onOpenChange={() => toggleGroup(group.label)}
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="w-full justify-between px-4 py-1.5 h-auto text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {group.label}
                    <motion.div
                      animate={{ rotate: openGroups[group.label] ? 0 : -90 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </motion.div>
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <AnimatePresence>
                    {group.items.map((item, index) => (
                      <MenuItemLink
                        key={item.href}
                        item={item}
                        isActive={pathname === item.href}
                        index={groupIndex * 10 + index}
                      />
                    ))}
                  </AnimatePresence>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <div className="px-2">
                {group.items.map((item, index) => (
                  <MenuItemLink
                    key={item.href}
                    item={item}
                    isActive={pathname === item.href}
                    index={index}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </ScrollArea>
    </div>
  )
}

function MenuItemLink({ 
  item, 
  isActive, 
  index 
}: { 
  item: MenuItem
  isActive: boolean
  index: number 
}) {
  const Icon = item.icon
  
  return (
    <motion.div
      custom={index}
      variants={itemVariants}
      initial="hidden"
      animate="visible"
    >
      <Link href={item.href}>
        <div
          className={cn(
            'flex items-center gap-3 px-3 py-2 mx-2 rounded-lg text-sm transition-all',
            isActive
              ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          )}
        >
          <Icon className={cn('h-4 w-4', isActive && 'text-inherit')} />
          <span>{item.label}</span>
        </div>
      </Link>
    </motion.div>
  )
}
