/**
 * 网关 / 工具返回、不应作用户聊天展示的大块 JSON：
 * - `sessions_list`：`{ count, sessions: [...] }`
 * - 配置文件读取等：`{ ok, result: { path, exists?, raw? } }`（如 openclaw.json）
 */

const MAX_PARSE_LEN = 1_200_000

export type SessionsListDumpMatch = {
  count: number
  sessionCount: number
}

/** 去掉本客户端曾写入的一行摘要，便于对「摘要 + JSON」脏数据再识别 */
function stripLeadingClientInfraSummary(content: string): string {
  let t = String(content ?? '').trimStart()
  if (!t.startsWith('已收到网关')) return t
  const nl = t.indexOf('\n')
  if (nl < 0) return ''
  return t.slice(nl + 1).trimStart()
}

/**
 * 与 `chat-helpers.extractLeadingJsonObject` 同逻辑；本文件不引用 chat-helpers，避免循环依赖。
 * 用于「Sender (untrusted…) / 说明文字」前缀后的首段 JSON 对象。
 */
function extractLeadingJsonObjectForInfra(content: string): string | null {
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

/** 从已知 `{` 下标切出平衡的一层 `{ ... }`（尊重字符串与转义），避免首 `{`…末 `}` 跨多个对象 */
function sliceBalancedJsonObject(s: string, openBraceIndex: number): string | null {
  if (openBraceIndex < 0 || openBraceIndex >= s.length || s[openBraceIndex] !== '{') return null
  let depth = 0
  let inStr = false
  let escaped = false
  for (let i = openBraceIndex; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inStr = false
        continue
      }
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(openBraceIndex, i + 1)
    }
  }
  return null
}

function collectOpenclawConfigReadJsonCandidates(stripped: string): string[] {
  const out: string[] = []
  const push = (s: string | null) => {
    if (!s || s.length > MAX_PARSE_LEN || !s.startsWith('{')) return
    if (!out.includes(s)) out.push(s)
  }
  const head = stripped.trimStart()
  if (head.startsWith('{')) push(head)

  const needles = ['\n{"ok":', '\n{ "ok":', '\r\n{"ok":', '\r\n{ "ok":']
  for (const nd of needles) {
    let from = 0
    while (from < stripped.length) {
      const i = stripped.indexOf(nd, from)
      if (i < 0) break
      const brace = stripped.indexOf('{', i)
      push(sliceBalancedJsonObject(stripped, brace))
      from = i + 1
    }
  }
  push(extractLeadingJsonObjectForInfra(stripped))
  return out
}

function bodyForInfraMatch(content: string): string {
  const t = String(content ?? '').trimStart()
  const stripped = stripLeadingClientInfraSummary(t)
  if (stripped.startsWith('{')) return stripped
  const extracted = extractLeadingJsonObjectForInfra(stripped)
  if (extracted) return extracted
  return stripped.length > 0 ? stripped : t
}

export function matchOpenclawSessionsListPayload(content: string): SessionsListDumpMatch | null {
  const t = bodyForInfraMatch(content).trimStart()
  if (!t.startsWith('{')) return null
  if (t.length > MAX_PARSE_LEN) return null
  try {
    const o = JSON.parse(t) as Record<string, unknown>
    if (typeof o.count !== 'number' || !Number.isFinite(o.count)) return null
    if (!Array.isArray(o.sessions)) return null
    const sessions = o.sessions as unknown[]
    if (sessions.length === 0) return { count: o.count, sessionCount: 0 }
    const first = sessions[0]
    if (!first || typeof first !== 'object') return null
    const row = first as Record<string, unknown>
    if (typeof row.key !== 'string') return null
    const hasShape =
      'sessionId' in row ||
      'transcriptPath' in row ||
      'messages' in row ||
      'updatedAt' in row ||
      'deliveryContext' in row
    if (!hasShape) return null
    return { count: o.count, sessionCount: sessions.length }
  } catch {
    return null
  }
}

export function matchOpenclawConfigFileReadPayload(content: string): { path: string } | null {
  const stripped = stripLeadingClientInfraSummary(String(content ?? '').trimStart())
  for (const t of collectOpenclawConfigReadJsonCandidates(stripped)) {
    if (!t.startsWith('{') || t.length > MAX_PARSE_LEN) continue
    try {
      const o = JSON.parse(t) as Record<string, unknown>
      if (typeof o.ok !== 'boolean') continue
      const r = o.result
      if (!r || typeof r !== 'object') continue
      const res = r as Record<string, unknown>
      if (typeof res.path !== 'string') continue
      const p = res.path.toLowerCase()
      if (!p.endsWith('.json') && !p.includes('openclaw')) continue
      if (typeof res.raw !== 'string' && typeof res.exists !== 'boolean') continue
      return { path: res.path }
    } catch {
      continue
    }
  }
  return null
}

export function matchAnyOpenclawGatewayInfraPayload(content: string): 'sessions' | 'config' | null {
  if (matchOpenclawSessionsListPayload(content)) return 'sessions'
  if (matchOpenclawConfigFileReadPayload(content)) return 'config'
  return null
}

export function formatOpenclawSessionsListDumpForDisplay(content: string): string | null {
  const m = matchOpenclawSessionsListPayload(content)
  if (!m) return null
  return `已收到网关返回的会话列表（${m.sessionCount} 个会话，count=${m.count}）。此为系统数据，非聊天正文。`
}

export function formatOpenclawGatewayInfraForDisplay(content: string): string | null {
  const sessions = formatOpenclawSessionsListDumpForDisplay(content)
  if (sessions) return sessions
  const cfg = matchOpenclawConfigFileReadPayload(content)
  if (cfg) {
    const base = cfg.path.replace(/^.*[/\\]/, '')
    return `已收到网关配置文件读取结果（${base}）。此为系统数据，非聊天正文。`
  }
  return null
}
