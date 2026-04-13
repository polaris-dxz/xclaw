import type { ChatSqliteDb } from '@/lib/chat-messages/chat-reply-writer'
import { readLatestAssistantReplyFromHistory } from '@/lib/openclaw-chat-history'
import { COORDINATOR_AGENT } from '@/lib/chat-messages/constants'
import type { ForwardInfo } from '@/lib/chat-messages/forward-info'
import { extractReplyText, stripGatewayXmlWrappers } from '@/lib/chat-messages/agent-wait-reply'
import { createChatReply, withPhase } from '@/lib/chat-messages/chat-reply-writer'
import { openclawMessageLine, stringifyOpenclawEventLine } from '@/lib/chat-messages/openclaw-event-shape'
import { logger } from '@/lib/logger'
import { parseGatewayJsonOutput } from '@/lib/openclaw-gateway'
import { writeAgentWaitDebugLogFile } from '@/lib/chat-messages/agent-wait-debug-log'
import {
  isTrivialAgentWaitPayload,
  isTrivialCompletionStdout,
  safeJsonStringify,
  truncateAgentWaitRaw,
} from '@/lib/chat-messages/agent-wait-raw-persist'

/**
 * 处理 agent.wait 结果：优先写入解析出的正文；否则写 chat.history；再否则写 raw JSON / stdout 快照，
 * 保证只要 CLI 有输出就有一条 DB 记录便于排查。
 */
export async function applyStandardChatAgentWaitPayloadToDb(
  db: ChatSqliteDb,
  workspaceId: number,
  conversation_id: string,
  to: string,
  from: string,
  forwardInfo: ForwardInfo,
  waitPayload: any,
  agentWaitStdout: string | null = null,
  agentWaitStderr: string | null = null,
): Promise<void> {
  const stdout = String(agentWaitStdout ?? '')
  const stderr = String(agentWaitStderr ?? '')
  const waitStatus =
    waitPayload && typeof waitPayload === 'object'
      ? String((waitPayload as Record<string, unknown>).status || '').toLowerCase()
      : ''

  const replyText =
    waitPayload && typeof waitPayload === 'object' ? extractReplyText(waitPayload) : null

  logger.info(
    {
      conversation_id,
      runId: forwardInfo.runId,
      waitStatus,
      hasReplyText: Boolean(replyText),
      replyTextPreview: replyText ? replyText.slice(0, 200) : null,
      payloadKeys: waitPayload && typeof waitPayload === 'object' ? Object.keys(waitPayload) : [],
      stdoutLen: stdout.length,
      stderrLen: stderr.length,
    },
    'applyStandardChatAgentWaitPayloadToDb',
  )

  if (replyText) {
    createChatReply(
      db,
      workspaceId,
      conversation_id,
      String(to),
      from,
      replyText,
      'text',
      withPhase('final', {
        role: 'assistant',
        status: waitStatus || 'completed',
        runId: forwardInfo.runId,
        source: 'agent.wait',
        parseOk: true,
        storage: 'parsed',
      }),
      stringifyOpenclawEventLine(openclawMessageLine('assistant', replyText, new Date().toISOString())),
    )
    return
  }

  let historyReply = await readLatestAssistantReplyFromHistory(forwardInfo.session || null)
  if (
    !historyReply &&
    typeof conversation_id === 'string' &&
    conversation_id.startsWith('gw:')
  ) {
    historyReply = await readLatestAssistantReplyFromHistory(conversation_id.slice(3))
  }
  if (historyReply) {
    historyReply = stripGatewayXmlWrappers(historyReply)
  }
  if (historyReply) {
    createChatReply(
      db,
      workspaceId,
      conversation_id,
      String(to),
      from,
      historyReply,
      'text',
      withPhase('final', {
        role: 'assistant',
        status: waitStatus || 'completed',
        runId: forwardInfo.runId,
        source: 'chat.history',
        parseOk: true,
        storage: 'parsed',
      }),
      stringifyOpenclawEventLine(openclawMessageLine('assistant', historyReply, new Date().toISOString())),
    )
    return
  }

  // --- raw 快照：保证有迹可循；完整 CLI 输出写入本地文件，避免把无正文的 JSON 当 content ---
  const parsedOuter = parseGatewayJsonOutput(stdout)
  const payloadForSnapshot =
    waitPayload && typeof waitPayload === 'object' && !isTrivialAgentWaitPayload(waitPayload)
      ? waitPayload
      : null

  const logPath = writeAgentWaitDebugLogFile({
    workspaceId,
    conversationId: conversation_id,
    runId: forwardInfo.runId,
    session: forwardInfo.session,
    stdout,
    stderr,
    waitPayload: waitPayload ?? null,
  })

  const onlyCompletionMetadata =
    !payloadForSnapshot &&
    (isTrivialCompletionStdout(stdout) ||
      (waitPayload != null &&
        typeof waitPayload === 'object' &&
        isTrivialAgentWaitPayload(waitPayload)))

  let storage: 'json' | 'text' | 'log' = 'text'
  let rawBody = ''
  let usePlaceholderContent = false

  if (onlyCompletionMetadata) {
    usePlaceholderContent = true
    storage = 'log'
  } else if (payloadForSnapshot) {
    storage = 'json'
    rawBody = safeJsonStringify(payloadForSnapshot)
  } else if (stdout.trim()) {
    storage = 'text'
    rawBody = stdout.trim()
  } else if (parsedOuter != null && typeof parsedOuter === 'object') {
    storage = 'json'
    rawBody = safeJsonStringify(parsedOuter)
  } else if (stderr.trim()) {
    rawBody = `[stderr]\n${stderr.trim()}`
  } else {
    rawBody = '[agent.wait] 无 stdout/stderr 可保存（CLI 可能未返回内容）。'
  }

  const { text: truncatedRaw, truncated } = usePlaceholderContent
    ? { text: '', truncated: false }
    : truncateAgentWaitRaw(rawBody)

  const contentForDb = usePlaceholderContent
    ? [
        '本轮 **agent.wait** 只返回了完成态（如 runId / status / endedAt），没有把助手正文放在该响应里，因此 **不会** 把这段 JSON 当作聊天正文写入。',
        '',
        `**完整 stdout、stderr 与解析对象** 已写入本地调试日志：`,
        '',
        `\`${logPath}\``,
        '',
        '正文通常需从 **chat.history**（依赖正确 session）或由网关 **SSE** 推送；若日志里 stdout 与网关 UI 不一致，请对照网关版本与 CLI。',
      ].join('\n')
    : truncatedRaw

  logger.warn(
    {
      conversation_id,
      runId: forwardInfo.runId,
      waitStatus,
      storage,
      truncated,
      onlyCompletionMetadata,
      logPath,
      preview: usePlaceholderContent ? '(placeholder)' : truncatedRaw.slice(0, 240),
    },
    'applyStandardChatAgentWaitPayloadToDb: persisting raw gateway snapshot',
  )

  createChatReply(
    db,
    workspaceId,
    conversation_id,
    String(to),
    from,
    contentForDb,
    'text',
    withPhase('final', {
      role: 'assistant',
      status: waitStatus || 'unknown',
      runId: forwardInfo.runId,
      source: 'agent.wait',
      parseOk: false,
      storage,
      truncated,
      gatewayRawResponse: !usePlaceholderContent,
      agentWaitLogFile: logPath,
    }),
    stringifyOpenclawEventLine(openclawMessageLine('assistant', contentForDb, new Date().toISOString())),
  )
}

export async function applyCoordinatorAgentWaitPayloadToDb(
  db: ChatSqliteDb,
  workspaceId: number,
  conversation_id: string,
  from: string,
  forwardInfo: ForwardInfo,
  waitPayload: any,
): Promise<void> {
  const replyText = extractReplyText(waitPayload)

  if (replyText) {
    createChatReply(
      db,
      workspaceId,
      conversation_id,
      COORDINATOR_AGENT,
      from,
      replyText,
      'text',
      withPhase('final', { status: String(waitPayload?.status || 'completed').toLowerCase(), runId: forwardInfo.runId }),
      stringifyOpenclawEventLine(openclawMessageLine('assistant', replyText, new Date().toISOString())),
    )
  }
}
