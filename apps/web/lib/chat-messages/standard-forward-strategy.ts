/**
 * 非 coord: 会话（含 gw:）：POST 请求内同步调用 agent.wait，
 * 有终稿再落库；中间态由前端 isAwaitingReply + loading 表现。
 */
import { runOpenClaw } from '@/lib/command'
import { logger } from '@/lib/logger'
import type { ForwardInfo } from '@/lib/chat-messages/forward-info'
import { normalizeAgentWaitPayloadFromStdout } from '@/lib/chat-messages/gateway-json'
import { applyStandardChatAgentWaitPayloadToDb } from '@/lib/chat-messages/apply-agent-wait'
import type { ChatSqliteDb } from '@/lib/chat-messages/chat-reply-writer'

export type StandardChatAgentWaitParams = {
  db: ChatSqliteDb
  workspaceId: number
  conversation_id: string
  to: string
  from: string
  forwardInfo: ForwardInfo
  agentWaitCliMs: number
  agentWaitInnerMs: number
}

/**
 * POST 请求内同步 agent.wait；`applyStandardChatAgentWaitPayloadToDb` 保证至少写入一条消息
 *（解析正文、chat.history 或 raw JSON/stdout 快照）。
 */
export async function runStandardChatAgentWaitInline(params: StandardChatAgentWaitParams): Promise<void> {
  const { db, workspaceId, conversation_id, to, from, forwardInfo, agentWaitCliMs, agentWaitInnerMs } = params

  if (!forwardInfo.delivered || !forwardInfo.runId) return

  logger.info(
    { conversation_id, runId: forwardInfo.runId, agentWaitInnerMs },
    'agent.wait inline: starting',
  )

  try {
    const waitResult = await runOpenClaw(
      [
        'gateway',
        'call',
        'agent.wait',
        '--timeout',
        String(agentWaitCliMs),
        '--params',
        JSON.stringify({
          runId: forwardInfo.runId,
          timeoutMs: agentWaitInnerMs,
        }),
        '--json',
      ],
      { timeoutMs: agentWaitCliMs + 5_000 },
    )

    const stdout = String(waitResult.stdout || '')

    logger.info(
      {
        conversation_id,
        runId: forwardInfo.runId,
        stdoutLen: stdout.length,
        stdoutPreview: stdout.slice(0, 500),
      },
      'agent.wait inline: CLI returned',
    )

    const waitPayload = normalizeAgentWaitPayloadFromStdout(stdout)

    logger.info(
      {
        conversation_id,
        runId: forwardInfo.runId,
        payloadIsNull: waitPayload == null,
        payloadKeys: waitPayload && typeof waitPayload === 'object' ? Object.keys(waitPayload) : [],
      },
      'agent.wait inline: normalized payload',
    )

    await applyStandardChatAgentWaitPayloadToDb(
      db,
      workspaceId,
      conversation_id,
      to,
      from,
      forwardInfo,
      waitPayload && typeof waitPayload === 'object' ? waitPayload : null,
      stdout,
      null,
    )
  } catch (waitErr) {
    const maybeWaitStdout = String((waitErr as any)?.stdout || '')
    const maybeWaitStderr = String((waitErr as any)?.stderr || '')

    logger.warn(
      {
        conversation_id,
        runId: forwardInfo.runId,
        stderrPreview: maybeWaitStderr.slice(0, 500),
        stdoutPreview: maybeWaitStdout.slice(0, 500),
      },
      'agent.wait inline: CLI threw',
    )

    const waitPayload = normalizeAgentWaitPayloadFromStdout(maybeWaitStdout)

    await applyStandardChatAgentWaitPayloadToDb(
      db,
      workspaceId,
      conversation_id,
      to,
      from,
      forwardInfo,
      waitPayload && typeof waitPayload === 'object' ? waitPayload : null,
      maybeWaitStdout,
      maybeWaitStderr,
    )
  }
}
