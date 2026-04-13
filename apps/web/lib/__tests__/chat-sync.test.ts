import { describe, expect, it } from 'vitest'
import {
  dropDuplicateOptimisticUserRows,
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

  it('dropDuplicateOptimisticUserRows removes negative id when positive duplicate exists', () => {
    const t = 1700000000
    const conv = [
      m({
        id: -123,
        conversation_id: 'c1',
        created_at: t,
        from_agent: 'you',
        content: 'hello  world',
      }),
      m({
        id: 42,
        conversation_id: 'c1',
        created_at: t + 1,
        from_agent: 'you',
        content: 'hello world',
      }),
    ]
    const out = dropDuplicateOptimisticUserRows(conv)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(42)
  })

  it('mergeConversationIntoMessages drops optimistic duplicate after merge', () => {
    const t = 1700000100
    const all = [
      m({
        id: -999,
        conversation_id: 'c1',
        created_at: t,
        from_agent: 'you',
        content: 'same',
      }),
    ]
    const incoming = [
      m({
        id: 7,
        conversation_id: 'c1',
        created_at: t,
        from_agent: 'you',
        content: 'same',
      }),
    ]
    const out = mergeConversationIntoMessages(all, 'c1', incoming)
    const c1 = out.filter((x) => x.conversation_id === 'c1')
    expect(c1).toHaveLength(1)
    expect(c1[0].id).toBe(7)
  })

  it('dropDuplicateOptimisticUserRows matches you optimistic to DB username + senderType', () => {
    const t = 1700000200
    const conv = [
      m({
        id: -1,
        conversation_id: 'c1',
        created_at: t,
        from_agent: 'you',
        content: '你好',
      }),
      m({
        id: 100,
        conversation_id: 'c1',
        created_at: t,
        from_agent: 'alice',
        content: '你好',
        metadata: { senderType: 'user' } as any,
      }),
    ]
    const out = dropDuplicateOptimisticUserRows(conv, null)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe(100)
  })
})
