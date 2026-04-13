/**
 * coord: 会话：网关投递成功后，在 POST 请求内同步 agent.wait 并落库（与 gw: 的 after 异步路径分离）。
 */
import { runOpenClaw } from '@/lib/command'
import { COORDINATOR_AGENT } from '@/lib/chat-messages/constants'
import type { ForwardInfo } from '@/lib/chat-messages/forward-info'
import { parseGatewayJson, normalizeAgentWaitPayloadFromStdout } from '@/lib/chat-messages/gateway-json'
import { summarizeOpenclawCliFailureForUser } from '@/lib/chat-messages/agent-wait-reply'
import { applyCoordinatorAgentWaitPayloadToDb } from '@/lib/chat-messages/apply-agent-wait'
import { createChatReply, withPhase, type ChatSqliteDb } from '@/lib/chat-messages/chat-reply-writer'
import { openclawMessageLine, stringifyOpenclawEventLine } from '@/lib/chat-messages/openclaw-event-shape'

export type CoordinatorThreadWaitParams = {
  db: ChatSqliteDb
  workspaceId: number
  conversation_id: string
  from: string
  forwardInfo: ForwardInfo
  agentWaitCliMs: number
  agentWaitInnerMs: number
}

export async function runCoordinatorThreadAfterGatewaySend(
  params: CoordinatorThreadWaitParams,
): Promise<void> {
  const { db, workspaceId, conversation_id, from, forwardInfo, agentWaitCliMs, agentWaitInnerMs } =
    params

  if (!forwardInfo.delivered) return

  if (!forwardInfo.runId) return

  try {
    const waitResult = await runOpenClaw(
      [
        'gateway',
        'call',
        'agent.wait',
        '--timeout',
        String(agentWaitCliMs),
        '--params',
        JSON.stringify({ runId: forwardInfo.runId, timeoutMs: agentWaitInnerMs }),
        '--json',
      ],
      { timeoutMs: agentWaitCliMs + 5_000 },
    )

    const waitPayload = normalizeAgentWaitPayloadFromStdout(waitResult.stdout)
    if (waitPayload && typeof waitPayload === 'object') {
      await applyCoordinatorAgentWaitPayloadToDb(
        db,
        workspaceId,
        conversation_id,
        from,
        forwardInfo,
        waitPayload,
      )
    }
  } catch (waitErr) {
    const maybeWaitStdout = String((waitErr as any)?.stdout || '')
    const maybeWaitStderr = String((waitErr as any)?.stderr || '')
    const waitPayload = normalizeAgentWaitPayloadFromStdout(maybeWaitStdout)
    if (waitPayload && typeof waitPayload === 'object') {
      await applyCoordinatorAgentWaitPayloadToDb(
        db,
        workspaceId,
        conversation_id,
        from,
        forwardInfo,
        waitPayload,
      )
    } else {
      const parsedErr = parseGatewayJson(maybeWaitStdout) as { error?: string } | null
      const reason =
        typeof parsedErr?.error === 'string'
          ? parsedErr.error
          : summarizeOpenclawCliFailureForUser(maybeWaitStderr, maybeWaitStdout)

      const short = String(reason || 'unknown').slice(0, 800)
      createChatReply(
        db,
        workspaceId,
        conversation_id,
        COORDINATOR_AGENT,
        from,
        short,
        'status',
        withPhase('error', { status: 'unknown', runId: forwardInfo.runId }),
        stringifyOpenclawEventLine(openclawMessageLine('assistant', short, new Date().toISOString())),
      )
    }
  }
}
