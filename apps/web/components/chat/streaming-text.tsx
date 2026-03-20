'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface StreamingTextProps {
  text: string
  isStreaming: boolean
  speed?: number
  className?: string
}

export function StreamingText({ 
  text, 
  isStreaming, 
  speed = 30,
  className 
}: StreamingTextProps) {
  const [displayedText, setDisplayedText] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  
  useEffect(() => {
    if (!isStreaming) {
      setDisplayedText(text)
      setCurrentIndex(text.length)
      return
    }
    
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText(text.slice(0, currentIndex + 1))
        setCurrentIndex(currentIndex + 1)
      }, speed)
      
      return () => clearTimeout(timeout)
    }
  }, [text, currentIndex, isStreaming, speed])
  
  useEffect(() => {
    if (text.length > displayedText.length && isStreaming) {
      // 当有新文本时，继续显示
      setCurrentIndex(displayedText.length)
    }
  }, [text, displayedText.length, isStreaming])
  
  return (
    <span className={cn('relative', className)}>
      {displayedText}
      {isStreaming && currentIndex < text.length && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 0.8, repeat: Infinity }}
          className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 align-middle"
        />
      )}
    </span>
  )
}
