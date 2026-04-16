import type { ChatMessage, CurrentUser } from '@/store'
import {
  isUntrustedSenderEnvelopeContent,
  stripUntrustedSenderMetadataEnvelope,
} from '../../lib/chat-messages/untrusted-sender-envelope'
import { matchAnyOpenclawGatewayInfraPayload } from '../../lib/chat-messages/openclaw-infra-tool-json'

type ConversationLike = {
  id: string
  name?: string
  customTitle?: string
  lastMessage?: {
    content?: string
  }
}

type ResolveRecipientInput = {
  content: string
  activeConversation?: string | null
  selectedAgent?: string | null
  fallbackAgent?: string | null
}

/**
 * 服务端会把文本/Word 附件内联进 content 供模型阅读；会话气泡展示时应去掉，避免整份文件占满界面。
 * 与 `appendInlinedTextFromAttachments` / `appendDocxTextFromAttachments`（route）中的块格式一致。
 */
const ATTACHMENT_ONLY_DISPLAY_HINT = '（用户上传了附件，请根据附件内容处理。）'

export function stripInlinedAttachmentPreviewFromUserContent(content: string): string {
  let out = String(content ?? '')
  out = out.replace(/\n\n---\n【Word「[^」]+」提取正文】\n[\s\S]*?(?=\n\n---\n【|$)/g, '')
  out = out.replace(/\n\n---\n【附件「[^」]+」】\n[\s\S]*?(?=\n\n---\n【|$)/g, '')
  out = out.replace(/\s+$/u, '').trimEnd()
  // 仅附件、无正文时服务端写入的占位句，不必在气泡里展示（下方仍有附件缩略）
  if (out.trim() === ATTACHMENT_ONLY_DISPLAY_HINT) return ''
  return out
}

export function extractMentionQuery(value: string, cursorPos: number): string | null {
  const textBeforeCursor = value.slice(0, cursorPos)
  const match = textBeforeCursor.match(/@([a-zA-Z0-9_-]*)$/)
  return match ? match[1] : null
}

export function insertMentionAtCursor(
  value: string,
  cursorPos: number,
  agentName: string
): { text: string; nextCursor: number } {
  const textBeforeCursor = value.slice(0, cursorPos)
  const textAfterCursor = value.slice(cursorPos)
  const atIndex = textBeforeCursor.lastIndexOf('@')
  if (atIndex < 0) {
    return { text: value, nextCursor: cursorPos }
  }

  const nextAfter = textAfterCursor.startsWith(' ') ? textAfterCursor.slice(1) : textAfterCursor
  const nextText = `${textBeforeCursor.slice(0, atIndex)}@${agentName} ${nextAfter}`
  return {
    text: nextText,
    nextCursor: atIndex + agentName.length + 2,
  }
}

export function filterConversationsByQuery<T extends ConversationLike>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items

  return items.filter((item) => {
    const title = (item.customTitle || item.name || '').toLowerCase()
    const id = item.id.toLowerCase()
    const last = (item.lastMessage?.content || '').toLowerCase()
    return title.includes(q) || id.includes(q) || last.includes(q)
  })
}

export function resolveOutgoingRecipient(input: ResolveRecipientInput): { to: string | null; content: string } {
  const mentionMatch = input.content.match(/^@([a-zA-Z0-9_-]+)\s+/)
  if (mentionMatch) {
    return {
      to: mentionMatch[1],
      content: input.content.replace(/^@[a-zA-Z0-9_-]+\s+/, ''),
    }
  }

  const conv = String(input.activeConversation || '')
  if (conv.startsWith('agent_')) {
    return { to: conv.replace(/^agent_/, ''), content: input.content }
  }

  const selected = String(input.selectedAgent || '').trim()
  if (selected && selected !== 'all') {
    return { to: selected, content: input.content }
  }

  const fallback = String(input.fallbackAgent || '').trim()
  if (fallback) {
    return { to: fallback, content: input.content }
  }

  return { to: null, content: input.content }
}

/** 从消息正文中取出 JSON 对象字符串（支持 ```json 围栏或首尾大括号） */
export function extractLeadingJsonObject(content: string): string | null {
  const t = content.trim()
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/.exec(t)
  if (fenced) {
    const inner = fenced[1].trim()
    if (inner.startsWith('{')) return inner
  }
  const start = t.indexOf('{')
  if (start < 0) return null
  const end = t.lastIndexOf('}')
  if (end <= start) return null
  return t.slice(start, end + 1)
}

/**
 * Gateway / 工具中间结果 JSON（常见为报错信封）。
 * 正常工具成功体在 jsonl 里为 `role:"toolResult"`，应由 transcript-parser → `message_type: tool_call` 展示，勿依赖正文猜形状。
 */
export function looksLikeGatewayToolProcessJson(content: string): boolean {
  const raw = extractLeadingJsonObject(content)
  if (!raw) return false
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    if (o.error != null && (typeof o.message === 'string' || typeof o.docs === 'string')) return true
    if (typeof o.error === 'string' && o.error.length > 0) return true
    if (o.status === 'error' && typeof o.tool === 'string') return true
    if (typeof o.tool === 'string' && o.error != null) return true
    return false
  } catch {
    return false
  }
}

/** @deprecated 使用 looksLikeGatewayToolProcessJson */
export function looksLikeGatewayToolErrorJson(content: string): boolean {
  return looksLikeGatewayToolProcessJson(content)
}

/**
 * 部分模型会把最终回复包在 `final` 阶段 XML 标签中；这是内部标记，不应展示给用户。
 * 从正文开头成对剥离（`</final>` 后可能还有 OpenClaw 页脚等，不能用整串 `$` 匹配）。
 */
export function stripAssistantXmlFinalWrapper(raw: string): string {
  let t = String(raw ?? '').trim()
  if (!t) return String(raw ?? '')

  const pairFromStart = /^<final\b[^>]*>\s*([\s\S]*?)\s*<\/final\b[^>]*>/i
  for (let i = 0; i < 8; i += 1) {
    const m = t.match(pairFromStart)
    if (!m) break
    const rest = t.slice(m[0].length)
    t = (m[1].trim() + rest).trimStart()
  }
  t = t.replace(/^<final\b[^>]*>\s*/i, '')
  // 反复剥尾部 </final>，避免末尾空白、多段闭合或模型只输出闭合标签时残留
  for (let j = 0; j < 16; j += 1) {
    const next = t.replace(/\s*<\/final\b[^>]*>\s*$/i, '').trimEnd()
    if (next === t) break
    t = next
  }
  return t.trimEnd()
}

/**
 * OpenClaw 常在助手回复末尾拼接版本、Token、Context、Session key、Queue 等元信息（通常以「🦞 OpenClaw」起头），
 * 不应在聊天主区域当正文展示。
 */
export function stripOpenClawAssistantFooter(raw: string): string {
  const text = String(raw ?? '')
  const trimmed = text.trim()
  if (!trimmed) return text

  if (/^🦞\s*OpenClaw\b[\s\S]*$/u.test(trimmed)) {
    return ''
  }

  let out = text
  out = out.replace(/\r?\n\r?\n🦞\s*OpenClaw[\s\S]*$/u, '')
  out = out.replace(/\r?\n🦞\s*OpenClaw[\s\S]*$/u, '')
  return out.trimEnd()
}

/** 再导出，便于只引用 chat-helpers 的调用方 */
export { stripUntrustedSenderMetadataEnvelope }

/**
 * Gateway 会把「工具 JSON、会话启动指令、读入的 workspace 文件正文」等都以 role=user 写入历史，
 * 与真人输入共用 from_agent=user —— 这些不是用户气泡，应归入思考过程时间线。
 */
export function isGatewaySyntheticUserContext(message: ChatMessage): boolean {
  const content = String(message.content || '')
  const t = content.trimStart()

  /** 信封后仍有正文 → 视为人类轮次（仅包装脏），勿归入已隐藏的思考过程组 */
  if (isUntrustedSenderEnvelopeContent(t)) {
    return stripUntrustedSenderMetadataEnvelope(content).trim().length === 0
  }

  if (looksLikeGatewayToolProcessJson(content)) return true

  if (t.startsWith('A new session was started via')) return true

  const firstLine = (t.split(/\r?\n/)[0] || '').trim()
  if (/^#\s+SOUL\.md\b/i.test(firstLine)) return true
  if (/^#\s+USER\.md\b/i.test(firstLine)) return true
  if (/^#\s+MEMORY\.md\b/i.test(firstLine)) return true
  if (/^#\s+AGENTS\.md\b/i.test(firstLine)) return true

  return false
}

function isOpenclawGatewayInfraMessage(message: ChatMessage): boolean {
  if (message.message_type !== 'text') return false
  return matchAnyOpenclawGatewayInfraPayload(String(message.content || '')) != null
}

export function isUserChatMessage(message: ChatMessage, currentUser: CurrentUser | null): boolean {
  const metadata = (message.metadata || {}) as Record<string, unknown>
  const senderType = String(metadata.senderType || '').toLowerCase()
  const from = String(message.from_agent || '').trim().toLowerCase()

  /** 本机客户端始终以真人计 */
  if (from === 'you') return true

  /** 网关工具大块 JSON（sessions_list、openclaw.json 读取等）常有 senderType=user，必须先排除 */
  if (isOpenclawGatewayInfraMessage(message)) return false

  if (senderType === 'user') return true

  /** Gateway 的 role=user 含工具回包与读文件内容，需排除后再认真人 */
  if (isGatewaySyntheticUserContext(message)) return false

  /** jsonl 转录常见 from_agent 字面为 "user" */
  if (from === 'user' && message.message_type === 'text') return true

  if (String(metadata.role || '').toLowerCase() === 'user') return true

  const u = currentUser?.username?.trim().toLowerCase()
  const d = currentUser?.display_name?.trim().toLowerCase()
  if (u && from === u) return true
  if (d && from === d) return true

  const emailLocal = currentUser?.email?.split('@')[0]?.trim().toLowerCase()
  if (emailLocal && from === emailLocal) return true

  return false
}

/**
 * 助手短文本中的「技能安装 / 路径确认」等过程性回执，应并入思考时间线，避免夹在最终正文前像「上一条回复」。
 * 刻意保守：长文、含二级标题的文档式回复不归入此类。
 */
export function isAssistantProceduralAck(message: ChatMessage): boolean {
  if (message.message_type !== 'text') return false
  const meta = (message.metadata || {}) as Record<string, unknown>
  if (String(meta.role || '').toLowerCase() !== 'assistant') return false
  const c = String(message.content || '')
  if (c.length > 4000) return false
  if (/\n##\s+\S/.test(c) && c.length > 800) return false

  if (
    /\/\.xclaw\/workspace\/skills|workspace\/skills\/|skills\/caldav/i.test(c) ||
    /SKILL\.md/i.test(c) ||
    /安装成功[!.!。.✅\s]|安装完成[!.!。.]|已成功安装/i.test(c) ||
    /是否需要.*读.*SKILL/i.test(c)
  ) {
    return true
  }
  return false
}

/**
 * 是否属于「思考/过程」消息（可合并进时间线），而非用户可见的最终正文块。
 */
export function isThinkingProcessMessage(message: ChatMessage, currentUser: CurrentUser | null): boolean {
  if (isUserChatMessage(message, currentUser)) return false
  const meta = (message.metadata || {}) as Record<string, unknown>
  const phase = String(meta.phase || '').toLowerCase()
  const status = String(meta.status || '').toLowerCase()

  if (message.message_type === 'tool_call' || meta.event === 'tool_call') return true

  /**
   * assistant 正文默认独立成块；例外：过程性短回执（技能安装等）并入时间线。
   * 仍不把「phase=thinking 的长段 assistant」自动并入，以免误标把最终回答塞进时间线（见单测）。
   */
  if (message.message_type === 'text' && String(meta.role || '').toLowerCase() === 'assistant') {
    if (isAssistantProceduralAck(message)) return true
    return false
  }

  if (phase === 'thinking') return true

  if (message.message_type === 'status') {
    if (phase === 'final' && status !== 'processing' && status !== 'accepted') return false
    if (phase === 'error' && ['error', 'delivery_failed', 'unknown', 'offline'].includes(status)) return true
    if (status === 'accepted' || status === 'processing') return true
    return phase !== 'final'
  }

  if (message.message_type === 'text') {
    if (isOpenclawGatewayInfraMessage(message)) return true
    if (looksLikeGatewayToolProcessJson(message.content)) return true
    if (isGatewaySyntheticUserContext(message)) return true
    if (phase === 'thinking') return true
    return false
  }

  return false
}

/** 主会话列表仅展示正文（text）；tool_call/status 等仍存库与 store，不在此列表渲染 */
export function filterVisibleChatMessagesForList(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.message_type === 'text')
}

export type ChatDisplayGroup =
  | { type: 'user'; messages: [ChatMessage] }
  | { type: 'thinking_group'; messages: ChatMessage[] }
  | { type: 'assistant_block'; messages: [ChatMessage] }

/** 将连续的过程类消息合并为一组，便于单块时间线展示 */
export function groupMessagesForDisplay(
  messages: ChatMessage[],
  currentUser: CurrentUser | null
): ChatDisplayGroup[] {
  const sorted = [...messages].sort((a, b) => a.created_at - b.created_at)
  const groups: ChatDisplayGroup[] = []
  let i = 0
  while (i < sorted.length) {
    const m = sorted[i]
    if (isUserChatMessage(m, currentUser)) {
      groups.push({ type: 'user', messages: [m] })
      i++
      continue
    }
    if (isThinkingProcessMessage(m, currentUser)) {
      const chunk: ChatMessage[] = []
      while (i < sorted.length && isThinkingProcessMessage(sorted[i], currentUser)) {
        chunk.push(sorted[i])
        i++
      }
      if (chunk.length > 0) groups.push({ type: 'thinking_group', messages: chunk })
      continue
    }
    groups.push({ type: 'assistant_block', messages: [sorted[i]] })
    i++
  }
  return groups
}
