/** 与 settings / 前端 COORDINATOR 一致 */
export const COORDINATOR_AGENT =
  String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').trim() ||
  'coordinator'

export const GATEWAY_ATTACHMENT_ONLY_HINT = '（用户上传了附件，请根据附件内容处理。）'

export const MAX_INLINE_TEXT_CHARS = 200_000

export const WORD_DOC_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
])

/** 流式 / 长任务：agent.wait 内层超时（ms） */
export const DEFAULT_AGENT_WAIT_INNER_MS = 120_000
export const DEFAULT_AGENT_WAIT_CLI_EXTRA_MS = 20_000
