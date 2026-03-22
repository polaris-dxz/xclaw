/** OpenClaw Gateway session label：1–64 字符，全 store 唯一（见 sessions.patch） */

export const MAX_LABEL = 64

export function truncateSessionLabel(input: string, max: number = MAX_LABEL): string {
  const t = input.trim()
  if (!t) return ''
  return t.length <= max ? t : t.slice(0, max).trim()
}

/** 从用户首条消息提炼标题：首行、去简单 Markdown，再截断 */
export function deriveSessionLabelFromUserContent(content: string): string {
  let line = String(content || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? ''
  line = line
    .replace(/^#+\s*/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return truncateSessionLabel(line, MAX_LABEL)
}

/**
 * 首条用户消息写入 Gateway 时的 session label：取「第一个问题」的正文摘要（无随机串）。
 * 正文为空但有附件时，用附件名摘要；否则「新对话」。
 */
export function buildFirstMessageSessionLabel(
  userContent: string,
  _sessionKey: string,
  attachmentNames?: string[],
): string {
  const base = deriveSessionLabelFromUserContent(userContent)
  if (base) return truncateSessionLabel(base, MAX_LABEL)
  if (attachmentNames && attachmentNames.length > 0) {
    const hint = `[附件] ${attachmentNames.slice(0, 2).join('、')}${attachmentNames.length > 2 ? '…' : ''}`
    return truncateSessionLabel(hint, MAX_LABEL)
  }
  return truncateSessionLabel('新对话', MAX_LABEL)
}

export function isGatewayDuplicateLabelError(err: unknown): boolean {
  const s = String(err instanceof Error ? err.message : err)
  return /label already|already in use/i.test(s)
}
