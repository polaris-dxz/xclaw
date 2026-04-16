'use client'

import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { useEffect, useState } from 'react'
import { useModelSetupGate } from '@/lib/use-model-setup-gate'

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [desktopTopInset, setDesktopTopInset] = useState(0)
  useModelSetupGate()

  useEffect(() => {
    const electronApi = (window as Window & { electronAPI?: { platform?: string } }).electronAPI
    if (electronApi?.platform === 'darwin') {
      setDesktopTopInset(40)
    }
  }, [])

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden" style={{ paddingTop: desktopTopInset }}>
      {/* 顶部导航 */}
      <header className="h-12 flex items-center px-4 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            返回对话
          </Button>
        </Link>
        <div className="flex-1 text-center">
          <h1 className="text-sm font-medium">设置与管理</h1>
        </div>
        <div className="w-24" /> {/* 占位保持居中 */}
      </header>
      
      {/* 主内容区 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* 左侧菜单 */}
        <SettingsSidebar />
        
        {/* 右侧内容 */}
        <motion.main
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="flex-1 overflow-auto"
        >
          {children}
        </motion.main>
      </div>
    </div>
  )
}
