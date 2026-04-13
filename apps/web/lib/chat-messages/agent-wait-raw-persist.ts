import { parseGatewayJsonOutput, unwrapGatewayRpcResult } from '@/lib/openclaw-gateway'

/** agent.wait 落库时 raw 快照的最大字符数（避免 SQLite 单行过大） */
export const MAX_AGENT_WAIT_RAW_CHARS = 48_000

/** 仅为完成态元数据、不含可解析正文字段时，stringify 落库价值低，应优先保留完整 stdout */
export function isTrivialAgentWaitPayload(o: unknown): boolean {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false
  const r = o as Record<string, unknown>
  const keys = Object.keys(r)
  if (keys.length === 0) return true
  const rich = [
    'output',
    'message',
    'content',
    'text',
    'choices',
    'delta',
    'tool_calls',
    'tool',
    'entry',
    'key',
    'error',
    'response',
    'result',
  ]
  for (const k of keys) {
    const l = k.toLowerCase()
    if (rich.some((rk) => rk.toLowerCase() === l)) return false
  }
  const meta = new Set(['runid', 'status', 'endedat', 'ok', 'startedat', 'id'])
  return keys.every((k) => meta.has(k.toLowerCase()))
}

/** stdout 经解析后是否仅为 runId/status/endedAt 类完成态（无正文） */
export function isTrivialCompletionStdout(stdout: string): boolean {
  const t = stdout.trim()
  if (!t) return false
  const p = parseGatewayJsonOutput(t)
  if (p == null || typeof p !== 'object') return false
  if (isTrivialAgentWaitPayload(p)) return true
  const r = p as Record<string, unknown>
  if (r.result && typeof r.result === 'object' && isTrivialAgentWaitPayload(r.result)) return true
  const u = unwrapGatewayRpcResult(p)
  if (u && typeof u === 'object' && !Array.isArray(u) && isTrivialAgentWaitPayload(u)) return true
  return false
}

export function truncateAgentWaitRaw(s: string): { text: string; truncated: boolean } {
  const max = MAX_AGENT_WAIT_RAW_CHARS
  if (s.length <= max) return { text: s, truncated: false }
  return { text: `${s.slice(0, max)}\n\n…(truncated)`, truncated: true }
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
