import { describe, expect, it } from 'vitest'
import {
  maxCreatedAtForConversation,
  mergeConversationIntoMessages,
  sinceQueryParamFromMaxCreatedAt,
} from '../chat-sync'
import type { ChatMessage } from '@/store'

function m(p: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'conversation_id' | 'created_at'>): ChatMessage {
  return {
    from_agent: 'a',
    to_agent: 'b',
    content: '',
    message_type: 'text',
    ...p,
  } as ChatMessage
}

describe('chat-sync', () => {
  it('maxCreatedAtForConversation ignores negative ids', () => {
    const messages = [
      m({ id: -1, conversation_id: 'c1', created_at: 999 }),
      m({ id: 2, conversation_id: 'c1', created_at: 100 }),
    ]
    expect(maxCreatedAtForConversation(messages, 'c1')).toBe(100)
  })

  it('sinceQueryParamFromMaxCreatedAt uses max-1', () => {
    expect(sinceQueryParamFromMaxCreatedAt(0)).toBeNull()
    expect(sinceQueryParamFromMaxCreatedAt(1)).toBe(0)
    expect(sinceQueryParamFromMaxCreatedAt(100)).toBe(99)
  })

  it('mergeConversationIntoMessages merges by id', () => {
    const all = [
      m({ id: 1, conversation_id: 'c1', created_at: 1, content: 'a' }),
      m({ id: 2, conversation_id: 'c2', created_at: 1, content: 'b' }),
    ]
    const incoming = [m({ id: 3, conversation_id: 'c1', created_at: 2, content: 'new' })]
    const out = mergeConversationIntoMessages(all, 'c1', incoming)
    expect(out).toHaveLength(3)
    expect(out.find((x) => x.id === 3)?.content).toBe('new')
  })
})
