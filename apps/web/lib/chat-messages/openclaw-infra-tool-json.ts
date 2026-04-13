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

function bodyForInfraMatch(content: string): string {
  const t = String(content ?? '').trimStart()
  const stripped = stripLeadingClientInfraSummary(t)
  return stripped.length > 0 && stripped.startsWith('{') ? stripped : t
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
  const t = bodyForInfraMatch(content).trimStart()
  if (!t.startsWith('{')) return null
  if (t.length > MAX_PARSE_LEN) return null
  try {
    const o = JSON.parse(t) as Record<string, unknown>
    if (typeof o.ok !== 'boolean') return null
    const r = o.result
    if (!r || typeof r !== 'object') return null
    const res = r as Record<string, unknown>
    if (typeof res.path !== 'string') return null
    const p = res.path.toLowerCase()
    if (!p.endsWith('.json') && !p.includes('openclaw')) return null
    if (typeof res.raw !== 'string' && typeof res.exists !== 'boolean') return null
    return { path: res.path }
  } catch {
    return null
  }
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
