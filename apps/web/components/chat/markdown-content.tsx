'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { cn } from '@/lib/utils'

const remarkPlugins = [remarkGfm, remarkBreaks]

/** GFM 表格在窄屏下可横向滚动；具体表格样式由外层 `prose` + typography 插件负责 */
function buildMarkdownComponents(overrides?: Partial<Components>): Components {
  return { ...markdownComponentsBase, ...overrides }
}

const markdownComponentsBase: Components = {
  /** prose 默认会给 hr 负 margin，导致与正文左缘不齐；强制与段落同宽对齐 */
  hr: ({ ...props }) => (
    <hr className="my-4 w-full max-w-full border-0 border-t border-border/50 mx-0 box-border" {...props} />
  ),
  table: ({ node: _node, children, ...props }) => (
    <div className="my-4 w-full max-w-full overflow-x-auto rounded-md border border-border/70 bg-muted/15 px-2">
      <table className="w-full min-w-[min(100%,20rem)] border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  pre: ({ children, ...props }) => (
    <pre
      className="my-3 max-w-full overflow-x-auto rounded-md border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed"
      {...props}
    >
      {children}
    </pre>
  ),
}

const thinkingMutedOverrides: Partial<Components> = {
  p: ({ children, ...props }) => (
    <p className="my-1 text-sm leading-relaxed text-muted-foreground" {...props}>
      {children}
    </p>
  ),
  a: ({ children, href, ...props }) => (
    <a
      href={href}
      className="text-muted-foreground underline underline-offset-2 decoration-border hover:text-foreground"
      {...props}
    >
      {children}
    </a>
  ),
  strong: ({ children, ...props }) => (
    <strong className="font-medium text-foreground/90" {...props}>
      {children}
    </strong>
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-1 list-disc pl-4 text-sm text-muted-foreground" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-1 list-decimal pl-4 text-sm text-muted-foreground" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="my-0.5" {...props}>
      {children}
    </li>
  ),
  code: ({ children, className, ...props }) => {
    const isBlock = Boolean(className?.includes('language-'))
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-muted/60 px-1 py-0.5 text-[0.85em] text-foreground/90" {...props}>
        {children}
      </code>
    )
  },
}

export interface MarkdownContentProps {
  children: string
  className?: string
  /** 思考过程等次要区域：避免链接/强调使用主题主色（看起来像「绿色回复」） */
  tone?: 'default' | 'muted'
}

/**
 * 聊天 Markdown：GFM（表格、任务列表等）+ 软换行；默认外层请包一层 `prose`（需启用 @tailwindcss/typography）。
 */
export function MarkdownContent({ children, className, tone = 'default' }: MarkdownContentProps) {
  const components =
    tone === 'muted' ? buildMarkdownComponents(thinkingMutedOverrides) : markdownComponentsBase
  return (
    <div
      className={cn(
        'markdown-body w-full min-w-0',
        tone === 'muted' &&
          'prose prose-sm dark:prose-invert max-w-none [&_hr]:mx-0 [&_hr]:w-full [&_blockquote]:mx-0',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
