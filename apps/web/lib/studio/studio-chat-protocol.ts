/** postMessage 协议：主应用 ↔ Studio iframe，与 Flask /openclaw-chat 解耦 */

export const STUDIO_CHAT_CONTEXT = 'xclaw:studio-chat-context'
export const STUDIO_CHAT_SEND = 'xclaw:studio-chat-send'
export const STUDIO_CHAT_RESULT = 'xclaw:studio-chat-result'

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
