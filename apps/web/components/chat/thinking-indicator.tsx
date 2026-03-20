'use client'

import { motion } from 'framer-motion'
import { Brain, Loader2 } from 'lucide-react'

interface ThinkingIndicatorProps {
  isThinking: boolean
  message?: string
}

export function ThinkingIndicator({ isThinking, message = '正在思考...' }: ThinkingIndicatorProps) {
  if (!isThinking) return null
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center gap-3 py-4"
    >
      <div className="relative">
        {/* 外圈脉冲动画 */}
        <motion.div
          className="absolute inset-0 rounded-full bg-primary/20"
          animate={{
            scale: [1, 1.5, 1],
            opacity: [0.5, 0, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        
        {/* 内圈 */}
        <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          >
            <Brain className="h-5 w-5 text-primary" />
          </motion.div>
        </div>
      </div>
      
      <div className="flex flex-col">
        <span className="text-sm font-medium">{message}</span>
        <div className="flex items-center gap-1 mt-1">
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0 }}
          />
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
          />
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-primary"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }}
          />
        </div>
      </div>
    </motion.div>
  )
}

// 简洁版思考状态（用于消息内）
export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-2 h-2 rounded-full bg-primary"
          animate={{
            y: [0, -6, 0],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}

// 渐变流动效果
export function GradientLoader() {
  return (
    <motion.div
      className="h-1 w-32 rounded-full overflow-hidden bg-secondary"
    >
      <motion.div
        className="h-full w-1/2 bg-gradient-to-r from-transparent via-primary to-transparent"
        animate={{ x: ['-100%', '200%'] }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </motion.div>
  )
}
