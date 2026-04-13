import { unwrapGatewayRpcResult } from '@/lib/openclaw-gateway'
import { logger } from '@/lib/logger'

function extractTextFromAnthropicStyleContent(content: unknown): string | null {
  if (typeof content === 'string' && content.trim()) return content.trim()
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    const t = String(b.type || '').toLowerCase()
    if ((t === 'text' || t === '' || t === 'output_text') && typeof b.text === 'string' && b.text.trim()) {
      parts.push(b.text.trim())
    }
  }
  return parts.length > 0 ? parts.join('\n').slice(0, 8000) : null
}

/** 剥离网关常见的 `<final>...</final>` 等 XML 包裹标签 */
export function stripGatewayXmlWrappers(text: string): string {
  let out = text
  const wrapMatch = out.match(
    /^\s*<(final|thinking|response|answer|reply)>\s*([\s\S]*?)\s*<\/\1>\s*$/i,
  )
  if (wrapMatch) out = wrapMatch[2]
  out = out.replace(/<\/?(?:final|thinking|response|answer|reply)>/gi, '')
  return out.trim()
}

export function extractReplyText(waitPayload: any): string | null {
  const raw = extractReplyTextRaw(waitPayload)

  logger.info(
    {
      hasRaw: raw != null,
      rawPreview: raw ? raw.slice(0, 200) : null,
      payloadKeys: waitPayload && typeof waitPayload === 'object' ? Object.keys(waitPayload) : [],
    },
    'extractReplyText: raw extraction result',
  )

  if (!raw) return null
  const cleaned = stripGatewayXmlWrappers(raw)
  return cleaned || null
}

function extractReplyTextRaw(waitPayload: any): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null

  // 先尝试直接从 payload 提取（normalizeAgentWaitPayloadFromStdout 已做过 unwrap）
  const directResult = extractFromPayloadObject(waitPayload)
  if (directResult) return directResult

  // 兜底：再做一次 unwrap 以兼容未经 normalize 的 raw payload
  const p = unwrapGatewayRpcResult<any>(waitPayload)
  if (!p || typeof p !== 'object' || p === waitPayload) return null

  return extractFromPayloadObject(p)
}

function extractFromPayloadObject(p: Record<string, any>): string | null {

  const fromTopContent = extractTextFromAnthropicStyleContent((p as Record<string, unknown>).content)
  if (fromTopContent) return fromTopContent

  const ch0 = (p as Record<string, unknown>).choices
  if (Array.isArray(ch0) && ch0[0] && typeof ch0[0] === 'object') {
    const m = (ch0[0] as Record<string, unknown>).message as Record<string, unknown> | undefined
    if (m && typeof m.content === 'string' && m.content.trim()) return m.content.trim()
    const fromChoice = extractTextFromAnthropicStyleContent(m?.content)
    if (fromChoice) return fromChoice
  }

  const directCandidates = [p.text, p.response, p.result]
  for (const value of directCandidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  if (typeof p.message === 'string' && p.message.trim()) return p.message.trim()
  if (p.message && typeof p.message === 'object') {
    const m = p.message as Record<string, unknown>
    for (const k of ['text', 'content', 'body']) {
      const v = m[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
  }

  if (typeof p.output === 'string' && p.output.trim()) return p.output.trim()

  if (typeof p.output === 'object' && p.output && !Array.isArray(p.output)) {
    const nested = [
      (p.output as Record<string, unknown>).text,
      (p.output as Record<string, unknown>).message,
      (p.output as Record<string, unknown>).content,
    ]
    for (const value of nested) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }

  if (Array.isArray(p.output)) {
    const parts: string[] = []
    for (const item of p.output) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      if (typeof o.text === 'string' && o.text.trim()) parts.push(o.text.trim())
      if (typeof o.content === 'string' && String(o.content).trim()) parts.push(String(o.content).trim())
      const role = String(o.role || '').toLowerCase()
      if (role === 'assistant' && Array.isArray(o.content)) {
        const t = extractTextFromAnthropicStyleContent(o.content)
        if (t) parts.push(t)
      }
      if (String(o.type || '').toLowerCase() === 'message' && Array.isArray(o.content)) {
        for (const block of o.content as unknown[]) {
          if (!block || typeof block !== 'object') continue
          const b = block as Record<string, unknown>
          const blockType = String(b.type || '')
          if (
            (blockType === 'text' || blockType === 'output_text' || blockType === 'input_text') &&
            typeof b.text === 'string' &&
            b.text.trim()
          ) {
            parts.push(b.text.trim())
          }
          if (typeof b.content === 'string' && String(b.content).trim()) {
            parts.push(String(b.content).trim())
          }
        }
      }
    }
    if (parts.length > 0) return parts.join('\n').slice(0, 8000)
  }

  if (p && typeof p === 'object' && (p as Record<string, unknown>).result) {
    const inner = (p as Record<string, unknown>).result
    if (inner && typeof inner === 'object') {
      const nested = extractFromPayloadObject(inner as Record<string, any>)
      if (nested) return nested
    }
  }

  return null
}

export function summarizeOpenclawCliFailureForUser(stderr: string, stdout: string): string {
  const e = String(stderr || '').trim()
  if (/Config was last written by a newer OpenClaw/i.test(e)) {
    return '当前 openclaw CLI 版本低于曾写入配置的版本，建议升级到与网关一致，或忽略（子进程 stdout 可能仍有有效 JSON）。'
  }
  if (/plugin disabled.*but config is present/i.test(e)) {
    return '配置中存在已禁用插件的残留项（非致命告警）。'
  }
  if (e) {
    const first = e.split('\n')[0] ?? e
    return first.length > 280 ? `${first.slice(0, 280)}…` : first
  }
  const o = String(stdout || '').trim()
  return o ? (o.length > 280 ? `${o.slice(0, 280)}…` : o) : '无法获取运行完成状态'
}
