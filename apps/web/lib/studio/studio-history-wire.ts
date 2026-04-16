import {
  isUserChatMessage,
  stripAssistantXmlFinalWrapper,
  stripInlinedAttachmentPreviewFromUserContent,
  stripOpenClawAssistantFooter,
} from '@/components/chat/chat-helpers'
import type { ChatMessage, CurrentUser } from '@/store'
import type { StudioHistoryWireMessage } from '@/lib/studio/studio-chat-protocol'

/** 与主会话 filterVisibleChatMessagesForList 一致：仅正文 text */
function isStudioTextMessage(m: ChatMessage): boolean {
  return m.message_type === 'text'
}

/**
 * 将 DB 拉取的消息转为 Studio iframe 可渲染的精简列表（user / agent 文本气泡）。
 * 仅 message_type === 'text'；助手侧剥离 &lt;final&gt; 包装与 OpenClaw 页脚，与 MessageItem 对齐。
 */
export function chatMessagesToStudioWire(
  messages: ChatMessage[],
  currentUser: CurrentUser | null,
): StudioHistoryWireMessage[] {
  const out: StudioHistoryWireMessage[] = []
  for (const m of messages) {
    if (!isStudioTextMessage(m)) continue
    const role = isUserChatMessage(m, currentUser) ? 'user' : 'agent'
    const raw = stripInlinedAttachmentPreviewFromUserContent(String(m.content || '')).trim()
    if (!raw) continue
    const text =
      role === 'user'
        ? raw
        : stripOpenClawAssistantFooter(stripAssistantXmlFinalWrapper(raw)).trim()
    if (!text) continue
    out.push({ role, text, at: typeof m.created_at === 'number' ? m.created_at : 0 })
  }
  out.sort((a, b) => a.at - b.at)
  return out
}
