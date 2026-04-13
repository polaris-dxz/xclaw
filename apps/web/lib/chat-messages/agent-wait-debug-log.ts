import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type AgentWaitDebugLogPayload = {
  workspaceId: number
  conversationId: string
  runId: string | undefined
  session: string | undefined
  stdout: string
  stderr: string
  /** normalize 后的对象，可能仅为完成态元数据 */
  waitPayload: unknown
}

/**
 * 将 agent.wait 完整上下文写入本地 JSON 文件（便于与 DB content 对照排查）。
 * 目录：`$OPENCLAW_STATE_DIR/logs/agent-wait/`（默认 `~/.xclaw/logs/agent-wait/`）
 */
export function writeAgentWaitDebugLogFile(payload: AgentWaitDebugLogPayload): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR || join(homedir(), '.xclaw')
  const dir = join(stateDir, 'logs', 'agent-wait')
  mkdirSync(dir, { recursive: true })
  const safeRun = String(payload.runId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  const file = join(dir, `${safeRun}-${Date.now()}.json`)
  const body = {
    at: new Date().toISOString(),
    ...payload,
    note:
      '网关 agent.wait 若仅返回 runId/status/endedAt，正文通常在 chat.history 或由 SSE 推送；请对照本文件中的 stdout 与网关侧日志。',
  }
  writeFileSync(file, JSON.stringify(body, null, 2), 'utf8')
  return file
}
