import { describe, expect, it } from 'vitest'
import {
  hasPersistedAssistantFinalForConversation,
  shouldClearAwaitingReplyForMessage,
} from '../awaiting-reply'
import type { ChatMessage, CurrentUser } from '@/store'

function msg(p: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'conversation_id' | 'created_at'>): ChatMessage {
  return {
    from_agent: 'x',
    to_agent: 'y',
    content: '',
    message_type: 'text',
    ...p,
  } as ChatMessage
}

describe('hasPersistedAssistantFinalForConversation', () => {
  const conv = 'gw:agent:main:ui-test'
  const user: CurrentUser = {
    id: 1,
    username: 'alice',
    display_name: 'Alice',
    role: 'viewer',
    email: 'a@b.c',
  }

  it('is false when only user + thinking status (no false positive from ambiguous text)', () => {
    const messages: ChatMessage[] = [
      msg({
        id: 1,
        conversation_id: conv,
        created_at: 1,
        from_agent: 'Administrator',
        to_agent: 'main',
        content: '你好',
        message_type: 'text',
        metadata: { senderType: 'user' },
      }),
      msg({
        id: 2,
        conversation_id: conv,
        created_at: 2,
        from_agent: 'main',
        to_agent: 'Administrator',
        content: '已收到…',
        message_type: 'status',
        metadata: { status: 'accepted', phase: 'thinking' },
      }),
    ]
    expect(hasPersistedAssistantFinalForConversation(messages, conv, user)).toBe(false)
  })

  it('is true when assistant text has phase final', () => {
    const messages: ChatMessage[] = [
      msg({
        id: 3,
        conversation_id: conv,
        created_at: 3,
        from_agent: 'main',
        to_agent: 'Administrator',
        content: '回答正文',
        message_type: 'text',
        metadata: { phase: 'final', role: 'assistant' },
      }),
    ]
    expect(hasPersistedAssistantFinalForConversation(messages, conv, user)).toBe(true)
  })
})

describe('shouldClearAwaitingReplyForMessage vs null runId (documented pitfall)', () => {
  it('would mis-clear on plain text if awaitingRunId is null — callers must not use this combo for “has final” UI', () => {
    const conv = 'c1'
    const state = {
      isAwaitingReply: true,
      awaitingConversationId: conv,
      awaitingRunId: null as string | null,
      currentUser: null as CurrentUser | null,
    }
    const ambiguous: ChatMessage = msg({
      id: 10,
      conversation_id: conv,
      created_at: 1,
      from_agent: 'main',
      content: 'no role no phase',
      message_type: 'text',
      metadata: {},
    })
    // 说明：这是旧逻辑在「无 awaitingRun」时 runMatches 恒真的后果；UI 侧已改用 hasPersistedAssistantFinalForConversation。
    expect(shouldClearAwaitingReplyForMessage(state, ambiguous)).toBe(true)
  })
})
