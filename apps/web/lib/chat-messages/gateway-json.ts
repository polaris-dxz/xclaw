import { parseGatewayJsonOutput, unwrapGatewayRpcResult } from '@/lib/openclaw-gateway'

export function parseGatewayJson(raw: string): any | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * CLI 可能因 stderr 配置告警仍以非零码退出，但 stdout 已是成功 JSON。
 */
export function gatewaySendStdoutIndicatesDelivered(stdout: string, parsed: unknown): boolean {
  if (parsed && typeof parsed === 'object') {
    const st = String((parsed as Record<string, unknown>).status || '').toLowerCase()
    if (st === 'started' || st === 'ok' || st === 'in_flight' || st === 'accepted') return true
  }
  const s = String(stdout || '')
  return (
    /"status"\s*:\s*"accepted"/i.test(s) ||
    /"status"\s*:\s*"started"/i.test(s) ||
    /"status"\s*:\s*"ok"/i.test(s) ||
    /"status"\s*:\s*"in_flight"/i.test(s)
  )
}

/** 剥掉连续 `{ result: { ... } }` 外壳，再走 unwrapGatewayRpcResult（部分 agent.wait 响应多层嵌套） */
function peelNestedRpcResult(payload: unknown): unknown {
  let cur: any = payload
  for (let i = 0; i < 8; i++) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) break
    if (!('result' in cur)) break
    const next = (cur as { result: unknown }).result
    if (next === null || typeof next !== 'object') break
    cur = next
  }
  return cur
}

/** agent.wait stdout：含前缀日志或多段 JSON 时用与 gateway 一致的解析，并解包 `result` */
export function normalizeAgentWaitPayloadFromStdout(stdout: string): any | null {
  const parsed = parseGatewayJsonOutput(String(stdout || ''))
  if (parsed == null || typeof parsed !== 'object') return null
  return unwrapGatewayRpcResult<any>(peelNestedRpcResult(parsed))
}
