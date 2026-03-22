import { runOpenClaw } from './command'

export function parseGatewayJsonOutput(raw: string): unknown | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null

  const objectStart = trimmed.indexOf('{')
  const arrayStart = trimmed.indexOf('[')
  const hasObject = objectStart >= 0
  const hasArray = arrayStart >= 0

  let start = -1
  let end = -1

  if (hasObject && hasArray) {
    if (objectStart < arrayStart) {
      start = objectStart
      end = trimmed.lastIndexOf('}')
    } else {
      start = arrayStart
      end = trimmed.lastIndexOf(']')
    }
  } else if (hasObject) {
    start = objectStart
    end = trimmed.lastIndexOf('}')
  } else if (hasArray) {
    start = arrayStart
    end = trimmed.lastIndexOf(']')
  }

  if (start < 0 || end < start) return null

  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * 部分环境下 `openclaw gateway call` 的 stdout 为 `{ result: { ok, key, entry, ... } }`，
 * 直接当 RPC 顶层解析会拿不到 `key`/`entry`，导致误判或未写入 label。
 */
export function unwrapGatewayRpcResult<T>(payload: unknown): T {
  if (payload === null || typeof payload !== 'object' || !('result' in payload)) {
    return payload as T
  }
  const inner = (payload as { result: unknown }).result
  if (inner === null || typeof inner !== 'object') {
    return payload as T
  }
  const r = inner as Record<string, unknown>
  if (
    'ok' in r ||
    'key' in r ||
    'entry' in r ||
    'error' in r ||
    'status' in r ||
    'runId' in r
  ) {
    return inner as T
  }
  return payload as T
}

export async function callOpenClawGateway<T = unknown>(
  method: string,
  params: unknown,
  timeoutMs = 10000,
): Promise<T> {
  const result = await runOpenClaw(
    [
      'gateway',
      'call',
      method,
      '--timeout',
      String(Math.max(1000, Math.floor(timeoutMs))),
      '--params',
      JSON.stringify(params ?? {}),
      '--json',
    ],
    { timeoutMs: timeoutMs + 2000 },
  )

  const payload = parseGatewayJsonOutput(result.stdout)
  if (payload == null) {
    throw new Error(`Invalid JSON response from gateway method ${method}`)
  }

  return payload as T
}
