import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

export type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: string }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system'
  parts: MessageContentPart[]
  timestamp?: string
  /** 从磁盘 jsonl 解析时的原始行（一行可展开为多行 UI/DB 记录时仍指向同一协议事件） */
  rawJsonlLine?: string
}

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/i

function isSilentReplyText(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text.trim())
}

/** OpenClaw jsonl：`role: "toolResult"`，`content` 常为 `[{ type:"text", text:"..." }]` */
function extractToolResultBodyText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((c: { type?: string; text?: string }) =>
      c && typeof c === 'object' && typeof c.text === 'string' ? c.text : '',
    )
    .join('\n')
    .trim()
}

function parseTranscriptParts(content: unknown): MessageContentPart[] {
  const parts: MessageContentPart[] = []

  if (typeof content === 'string' && content.trim()) {
    if (!isSilentReplyText(content)) {
      parts.push({ type: 'text', text: content.trim().slice(0, 8000) })
    }
    return parts
  }

  if (!Array.isArray(content)) return parts

  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      if (!isSilentReplyText(block.text)) {
        parts.push({ type: 'text', text: block.text.trim().slice(0, 8000) })
      }
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      parts.push({ type: 'thinking', thinking: block.thinking.slice(0, 4000) })
    } else if (
      block.type === 'tool_use' ||
      block.type === 'toolCall' ||
      String(block.type).toLowerCase() === 'toolcall'
    ) {
      const name = block.name || 'unknown'
      const id = block.id || ''
      const rawInput = block.type === 'tool_use' ? block.input : block.arguments
      const inputStr =
        typeof rawInput === 'string'
          ? rawInput.slice(0, 500)
          : JSON.stringify(rawInput ?? {}).slice(0, 500)
      parts.push({
        type: 'tool_use',
        id,
        name,
        input: inputStr,
      })
    } else if (
      block.type === 'tool_result' ||
      String(block.type || '')
        .toLowerCase()
        .replace(/-/g, '_') === 'toolresult'
    ) {
      const toolUseId = String(
        (block as { tool_use_id?: string; toolCallId?: string }).tool_use_id ||
          (block as { toolCallId?: string }).toolCallId ||
          '',
      ).trim()
      const resultContent = typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((c: any) => c?.text || '').join('\n')
          : ''
      if (resultContent.trim()) {
        parts.push({
          type: 'tool_result',
          toolUseId,
          content: resultContent.trim().slice(0, 8000),
          isError: block.is_error === true || (block as { isError?: boolean }).isError === true,
        })
      }
    }
  }

  return parts
}

/** Gateway chat.history 常见：顶层 `{ role, parts:[{type,text}] }` 而无 `content` 字段 */
function partsFromGatewayPartsArray(rawParts: unknown[]): MessageContentPart[] {
  const parts: MessageContentPart[] = []
  for (const part of rawParts) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    const t = String(p.type || '').toLowerCase()
    if ((t === 'text' || t === 'output_text' || t === 'input_text') && typeof p.text === 'string' && p.text.trim()) {
      if (!isSilentReplyText(p.text)) {
        parts.push({ type: 'text', text: p.text.trim().slice(0, 8000) })
      }
    } else if (t === 'thinking' && typeof p.thinking === 'string' && p.thinking.trim()) {
      parts.push({ type: 'thinking', thinking: p.thinking.trim().slice(0, 4000) })
    }
  }
  return parts
}

function normalizeTranscriptMessage(msg: any, timestamp?: string): TranscriptMessage | null {
  const base = msg?.message && typeof msg.message === 'object' ? msg.message : msg
  const roleRaw = String(base?.role ?? msg?.role ?? '').trim().toLowerCase()

  /**
   * OpenClaw `sessions/*.jsonl`：`type:"message"` + `message.role:"toolResult"` + toolName/toolCallId。
   * 若按普通 user 解析会把整段工具 JSON 当用户正文（web_fetch、gateway 读配置等）。
   */
  if (roleRaw === 'toolresult' || roleRaw === 'tool_result') {
    const toolUseId = String(base.toolCallId ?? base.tool_call_id ?? '').trim()
    const resultText = extractToolResultBodyText(base.content ?? base.text)
    if (!resultText) return null
    const isErr = base.isError === true || base.is_error === true
    return {
      role: 'assistant',
      parts: [
        {
          type: 'tool_result',
          toolUseId,
          content: resultText.slice(0, 8000),
          isError: isErr,
        },
      ],
      timestamp,
    }
  }

  const roleStr = String(base?.role ?? msg?.role ?? '').trim()
  const role = roleStr === 'assistant' ? ('assistant' as const)
    : roleStr === 'system' ? ('system' as const)
    : ('user' as const)

  let parts = parseTranscriptParts(base?.content ?? base?.text ?? msg?.content ?? msg?.text)
  if (parts.length === 0 && Array.isArray(base?.parts)) {
    parts = partsFromGatewayPartsArray(base.parts)
  }
  if (parts.length === 0 && Array.isArray(msg?.parts)) {
    parts = partsFromGatewayPartsArray(msg.parts)
  }

  if (parts.length === 0) return null
  return { role, parts, timestamp }
}

/**
 * Parse OpenClaw JSONL transcript format.
 *
 * Each line is a JSON object. We care about entries with type: "message"
 * which contain { message: { role, content } } in Claude API format.
 */
export function parseJsonlTranscript(raw: string, limit: number): TranscriptMessage[] {
  const lines = raw.split('\n').filter(Boolean)
  const out: TranscriptMessage[] = []

  for (const line of lines) {
    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    if (entry.type !== 'message' || !entry.message) continue

    const msg = entry.message as Record<string, unknown>
    const topRole =
      typeof (entry as Record<string, unknown>).role === 'string'
        ? String((entry as Record<string, unknown>).role).trim()
        : ''
    const innerRole = typeof msg.role === 'string' ? msg.role.trim() : ''
    /** 部分 jsonl 把 `role` 写在顶层，`message` 内无 role（否则 toolResult 会被误判为用户正文） */
    const mergedMsg = innerRole ? msg : topRole ? ({ ...msg, role: topRole } as Record<string, unknown>) : msg
    const ts = typeof entry.timestamp === 'string' ? entry.timestamp
      : typeof (msg as { timestamp?: string }).timestamp === 'string'
        ? (msg as { timestamp?: string }).timestamp
        : undefined
    const normalized = normalizeTranscriptMessage(mergedMsg, ts)
    if (normalized) {
      normalized.rawJsonlLine = line
      out.push(normalized)
    }
  }

  return out.slice(-limit)
}

export function parseGatewayHistoryTranscript(messages: unknown[], limit: number): TranscriptMessage[] {
  const out: TranscriptMessage[] = []

  for (const value of messages) {
    const entry = value as any
    if (!entry || typeof entry !== 'object') continue
    const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined
    const normalized = normalizeTranscriptMessage(entry, timestamp)
    if (normalized) {
      out.push(normalized)
    }
  }

  return out.slice(-limit)
}

/**
 * Read a session's JSONL transcript file from disk given stateDir, agentName, and sessionId.
 */
export function readSessionJsonl(stateDir: string, agentName: string, sessionId: string): string | null {
  const jsonlPath = path.join(stateDir, 'agents', agentName, 'sessions', `${sessionId}.jsonl`)
  if (!existsSync(jsonlPath)) return null
  try {
    return readFileSync(jsonlPath, 'utf-8')
  } catch {
    return null
  }
}
