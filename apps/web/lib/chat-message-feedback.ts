/**
 * 聊天消息点赞/点踩写入 metadata（与 PATCH /api/chat/messages/[id] 保持一致）
 */
export type ChatUserFeedback = 'up' | 'down'

export function mergeUserFeedbackMetadata(
  prev: Record<string, unknown> | null | undefined,
  input: { feedback: ChatUserFeedback | null; feedbackReason?: string },
  nowSec: number = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const base =
    prev && typeof prev === 'object' && !Array.isArray(prev) ? { ...prev } : ({} as Record<string, unknown>)

  if (input.feedback === null) {
    delete base.userFeedback
    delete base.feedbackReason
    delete base.feedbackAt
    return base
  }

  if (input.feedback === 'up') {
    base.userFeedback = 'up'
    delete base.feedbackReason
    base.feedbackAt = nowSec
    return base
  }

  const r = String(input.feedbackReason ?? '').trim()
  base.userFeedback = 'down'
  base.feedbackReason = r
  base.feedbackAt = nowSec
  return base
}
