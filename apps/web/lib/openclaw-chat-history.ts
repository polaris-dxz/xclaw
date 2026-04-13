import { callOpenClawGateway } from '@/lib/openclaw-gateway'
import { parseGatewayHistoryTranscript, type MessageContentPart } from '@/lib/transcript-parser'

/**
 * 从 Gateway chat.history 取最近一条 assistant 文本（用于 agent.wait 超时后补拉终稿）。
 */
export async function readLatestAssistantReplyFromHistory(
  sessionKey: string | null | undefined
): Promise<string | null> {
  const key = String(sessionKey || '').trim()
  if (!key) return null
  try {
    const history = await callOpenClawGateway<{ messages?: unknown[] }>(
      'chat.history',
      { sessionKey: key, limit: 30 },
      12000
    )
    const transcript = parseGatewayHistoryTranscript(Array.isArray(history?.messages) ? history.messages : [], 30)
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const msg = transcript[i]
      if (msg.role !== 'assistant') continue
      const parts = Array.isArray(msg.parts) ? msg.parts : []
      const text = parts
        .filter(
          (part: MessageContentPart): part is MessageContentPart & { type: 'text'; text: string } =>
            part.type === 'text' && typeof part.text === 'string',
        )
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join('\n')
        .trim()
      if (text) return text.slice(0, 8000)
    }
  } catch {
    // no-op
  }
  return null
}
