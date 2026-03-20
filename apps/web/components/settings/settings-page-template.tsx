'use client'

import { motion } from 'framer-motion'
import { type LucideIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Empty, EmptyIcon, EmptyTitle, EmptyDescription } from '@/components/ui/empty'

interface SettingsPageTemplateProps {
  title: string
  description: string
  icon: LucideIcon
  comingSoon?: boolean
  children?: React.ReactNode
}

export function SettingsPageTemplate({
  title,
  description,
  icon: Icon,
  comingSoon = true,
  children,
}: SettingsPageTemplateProps) {
  return (
    <div className="p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="space-y-6"
      >
        {/* 页面标题 */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-3">
              <Icon className="h-6 w-6 text-primary" />
              {title}
            </h1>
            <p className="text-muted-foreground mt-1">{description}</p>
          </div>
          {!comingSoon && (
            <Button>
              添加新项
            </Button>
          )}
        </div>
        
        {/* 内容区域 */}
        {comingSoon ? (
          <Card>
            <CardContent className="py-16">
              <Empty>
                <EmptyIcon>
                  <Icon className="h-10 w-10" />
                </EmptyIcon>
                <EmptyTitle>功能开发中</EmptyTitle>
                <EmptyDescription>
                  {title}功能正在积极开发中，敬请期待...
                </EmptyDescription>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          children
        )}
      </motion.div>
    </div>
  )
}
