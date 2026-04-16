/** postMessage 协议：主应用 ↔ Studio iframe，与 Flask /openclaw-chat 解耦 */

export const STUDIO_CHAT_CONTEXT = 'xclaw:studio-chat-context'
export const STUDIO_CHAT_SEND = 'xclaw:studio-chat-send'
export const STUDIO_CHAT_RESULT = 'xclaw:studio-chat-result'
/** 父窗口 → iframe：首包已成功后，将轮询到的助手终稿补写到对应气泡 */
export const STUDIO_CHAT_REPLY_UPDATE = 'xclaw:studio-chat-reply-update'
/** iframe → 父窗口：请求拉取某会话历史（父窗口带 cookie 调 Next API） */
export const STUDIO_CHAT_REQUEST_HISTORY = 'xclaw:studio-chat-request-history'
/** 父窗口 → iframe：历史消息列表（精简结构便于 iframe 纯 DOM 渲染） */
export const STUDIO_CHAT_HISTORY = 'xclaw:studio-chat-history'

export type StudioChatContextPayload = {
  type: typeof STUDIO_CHAT_CONTEXT
  conversationId: string | null
}

export type StudioChatSendPayload = {
  type: typeof STUDIO_CHAT_SEND
  requestId: string
  text: string
}

export type StudioChatResultPayload = {
  type: typeof STUDIO_CHAT_RESULT
  requestId: string
  ok: boolean
  error?: string
  /** 助手最终可见正文（尽力从主会话轮询得到） */
  reply?: string
}

export type StudioChatReplyUpdatePayload = {
  type: typeof STUDIO_CHAT_REPLY_UPDATE
  requestId: string
  reply: string
}

export type StudioChatRequestHistoryPayload = {
  type: typeof STUDIO_CHAT_REQUEST_HISTORY
  requestId: string
  conversationId: string
}

/** iframe 侧栏气泡：仅 user / agent 文本与时间排序 */
export type StudioHistoryWireMessage = {
  role: 'user' | 'agent'
  text: string
  at: number
}

export type StudioChatHistoryPayload = {
  type: typeof STUDIO_CHAT_HISTORY
  requestId: string
  ok: boolean
  error?: string
  messages?: StudioHistoryWireMessage[]
}
