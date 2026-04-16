import { describe, expect, it } from 'vitest'
import {
  extractMentionQuery,
  insertMentionAtCursor,
  filterConversationsByQuery,
  resolveOutgoingRecipient,
  extractLeadingJsonObject,
  looksLikeGatewayToolProcessJson,
  stripOpenClawAssistantFooter,
  stripAssistantXmlFinalWrapper,
  isGatewaySyntheticUserContext,
  isThinkingProcessMessage,
  groupMessagesForDisplay,
  isUserChatMessage,
  filterVisibleChatMessagesForList,
} from './chat-helpers'
import type { ChatMessage } from '../../store'
import { shouldClearAwaitingReplyForMessage } from '../../lib/awaiting-reply'

describe('extractMentionQuery', () => {
  it('returns mention query at cursor', () => {
    expect(extractMentionQuery('请 @alp', 6)).toBe('alp')
    expect(extractMentionQuery('@coordinator hello', 12)).toBe('coordinator')
  })

  it('returns null when cursor is not in mention token', () => {
    expect(extractMentionQuery('hello world', 5)).toBeNull()
    expect(extractMentionQuery('hello @agent done', 16)).toBeNull()
  })
})

describe('insertMentionAtCursor', () => {
  it('replaces active mention token and returns next cursor', () => {
    const result = insertMentionAtCursor('请 @alp 看一下', 6, 'alpha')
    expect(result.text).toBe('请 @alpha 看一下')
    expect(result.nextCursor).toBe(9)
  })
})

describe('stripOpenClawAssistantFooter', () => {
  it('removes trailing OpenClaw metadata block after double newline', () => {
    const body = '你的会话 ID 是 `x`。\n\n🦞 OpenClaw 2026.3.13\n🧵 Session: agent:main:ui-abc'
    expect(stripOpenClawAssistantFooter(body)).toBe('你的会话 ID 是 `x`。')
  })

  it('returns empty when entire message is metadata', () => {
    const only = '🦞 OpenClaw 2026.3.13 (abc)\n🧵 Session: agent:main:ui-deadbeef'
    expect(stripOpenClawAssistantFooter(only)).toBe('')
  })

  it('leaves unrelated text unchanged', () => {
    expect(stripOpenClawAssistantFooter('你好')).toBe('你好')
  })
})

describe('stripAssistantXmlFinalWrapper', () => {
  it('removes outer final tags and leaves body', () => {
    const body = '<final>第一段\n\n第二段</final>'
    expect(stripAssistantXmlFinalWrapper(body)).toBe('第一段\n\n第二段')
  })

  it('handles case-insensitive tags and strips nested wrappers', () => {
    expect(stripAssistantXmlFinalWrapper('<FINAL>x</FINAL>')).toBe('x')
    expect(stripAssistantXmlFinalWrapper('<final><final>y</final></final>')).toBe('y')
  })

  it('strips lone opening or closing tag when not paired', () => {
    expect(stripAssistantXmlFinalWrapper('<final>hello')).toBe('hello')
    expect(stripAssistantXmlFinalWrapper('world</final>')).toBe('world')
  })

  it('works before footer strip in pipeline', () => {
    const raw = '<final>答</final>\n\n🦞 OpenClaw 2026\n🧵 Session: x'
    expect(stripOpenClawAssistantFooter(stripAssistantXmlFinalWrapper(raw))).toBe('答')
  })
})

describe('filterConversationsByQuery', () => {
  const conversations = [
    { id: 'conv-1', name: '需求讨论', lastMessage: { content: '今天安排' } },
    { id: 'agent_research', name: 'Research', lastMessage: { content: 'vector index ready' } },
    { id: 'misc', name: '', lastMessage: { content: 'fallback id name' } },
  ]

  it('matches name, id and last message content', () => {
    expect(filterConversationsByQuery(conversations, '需求')).toHaveLength(1)
    expect(filterConversationsByQuery(conversations, 'research')).toHaveLength(1)
    expect(filterConversationsByQuery(conversations, 'index')).toHaveLength(1)
    expect(filterConversationsByQuery(conversations, 'misc')).toHaveLength(1)
  })

  it('returns original list when query is empty', () => {
    expect(filterConversationsByQuery(conversations, '  ')).toHaveLength(3)
  })
})

describe('extractLeadingJsonObject / looksLikeGatewayToolProcessJson', () => {
  it('parses fenced json and detects tool error envelope', () => {
    const body = '```json\n{"status":"error","tool":"web_fetch","error":"fail"}\n```'
    const raw = extractLeadingJsonObject(body)
    expect(raw).toContain('"tool":"web_fetch"')
    expect(looksLikeGatewayToolProcessJson(body)).toBe(true)
  })

  it('detects missing_brave style errors', () => {
    const j = '{"error":"missing_brave_api_key","message":"needs key","docs":"https://x"}'
    expect(looksLikeGatewayToolProcessJson(j)).toBe(true)
  })

  it('does not flag arbitrary assistant json', () => {
    expect(looksLikeGatewayToolProcessJson('{"result":"hello"}')).toBe(false)
  })
})

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content' | 'created_at'>): ChatMessage {
  return {
    conversation_id: 'c1',
    from_agent: 'user',
    to_agent: 'main',
    message_type: 'text',
    metadata: {},
    read_at: null,
    workspace_id: 1,
    ...partial,
  } as ChatMessage
}

describe('filterVisibleChatMessagesForList', () => {
  it('keeps only message_type text', () => {
    const rows = [
      msg({ id: 1, content: 'hi', created_at: 1, message_type: 'text' }),
      msg({ id: 2, content: '{}', created_at: 2, message_type: 'tool_call' }),
      msg({ id: 3, content: 'x', created_at: 3, message_type: 'status', metadata: { phase: 'error' } }),
    ]
    expect(filterVisibleChatMessagesForList(rows).map((m) => m.id)).toEqual([1])
  })
})

describe('gateway infra JSON must not be treated as human user', () => {
  it('isUserChatMessage is false for sessions dump on user row', () => {
    const raw = JSON.stringify({
      count: 1,
      sessions: [
        {
          key: 'agent:main:ui-x',
          sessionId: '4e51c2ee-5b55-4c2c-b787-de54be194485',
          messages: [],
        },
      ],
    })
    const m = msg({
      id: 99,
      content: raw,
      created_at: 1,
      from_agent: 'user',
      metadata: { role: 'user', source: 'jsonl-disk-sync' },
    })
    expect(isUserChatMessage(m, null)).toBe(false)
    expect(isThinkingProcessMessage(m, null)).toBe(true)
  })
})

describe('isGatewaySyntheticUserContext / gateway user vs real user', () => {
  it('treats tool JSON and SOUL bootstrap as synthetic', () => {
    expect(
      isGatewaySyntheticUserContext(
        msg({
          id: 1,
          content: '{"status":"error","tool":"read","error":"ENOENT"}',
          created_at: 1,
        }),
      ),
    ).toBe(true)
    expect(
      isGatewaySyntheticUserContext(
        msg({
          id: 2,
          content: 'A new session was started via /new or /reset. Run your Session Startup',
          created_at: 2,
        }),
      ),
    ).toBe(true)
    expect(
      isGatewaySyntheticUserContext(
        msg({
          id: 3,
          content: '# SOUL.md - Who You Are\n\nHello',
          created_at: 3,
        }),
      ),
    ).toBe(true)
  })

  it('does not flag real human text', () => {
    expect(
      isGatewaySyntheticUserContext(
        msg({
          id: 4,
          content: '我【晚上】想吃一顿【不是太寡淡的健康餐】',
          created_at: 4,
        }),
      ),
    ).toBe(false)
  })

  it('does not flag OpenClaw untrusted-sender envelope when user text remains after strip', () => {
    const raw = `Sender (untrusted metadata):
{"label":"cli","id":"cli"}
[Mon 2026-04-13 19:51 GMT+8] 你好`
    expect(
      isGatewaySyntheticUserContext(
        msg({
          id: 41,
          content: raw,
          created_at: 41,
          metadata: { role: 'user', source: 'jsonl-disk-sync' },
        }),
      ),
    ).toBe(false)
  })

  it('flags untrusted envelope with no remaining user text as synthetic', () => {
    const raw = `Sender (untrusted metadata):
{"label":"cli","id":"cli"}
[Mon 2026-04-13 19:51 GMT+8]`
    expect(
      isGatewaySyntheticUserContext(
        msg({
          id: 42,
          content: `${raw}\n`,
          created_at: 42,
          metadata: { role: 'user' },
        }),
      ),
    ).toBe(true)
  })

  it('assistant text with phase thinking is not merged into thinking timeline', () => {
    const messages: ChatMessage[] = [
      msg({
        id: 20,
        content: '最终回答正文',
        created_at: 1,
        from_agent: 'main',
        to_agent: 'user',
        metadata: { role: 'assistant', phase: 'thinking', source: 'gateway-history' },
      }),
    ]
    expect(isThinkingProcessMessage(messages[0], null)).toBe(false)
    const groups = groupMessagesForDisplay(messages, null)
    expect(groups.map((g) => g.type)).toEqual(['assistant_block'])
  })

  it('jsonl-sync tool_result row (message_type tool_call) is thinking', () => {
    const m = msg({
      id: 32,
      content: 'tool_result:call_function_x',
      message_type: 'tool_call',
      created_at: 1,
      from_agent: 'main',
      to_agent: 'user',
      metadata: {
        event: 'tool_call',
        toolName: 'tool_result',
        toolUseId: 'call_function_x',
        output: JSON.stringify({ url: 'https://en.wikipedia.org/wiki/Oppenheimer_(film)', status: 200 }),
        source: 'jsonl-disk-sync',
      },
    })
    expect(isThinkingProcessMessage(m, null)).toBe(true)
    expect(groupMessagesForDisplay([m], null).map((g) => g.type)).toEqual(['thinking_group'])
  })

  it('assistant skill-install ack is merged into thinking timeline, final answer stays a block', () => {
    const messages: ChatMessage[] = [
      msg({
        id: 21,
        content: '安装成功! ✅\n路径 /Users/x/.xclaw/workspace/skills/caldav-calendar\n是否读取 SKILL.md？',
        created_at: 1,
        from_agent: 'main',
        to_agent: 'user',
        message_type: 'text',
        metadata: { role: 'assistant', phase: 'final' },
      }),
      msg({
        id: 22,
        content: '## 学习计划\n\n正文',
        created_at: 2,
        from_agent: 'main',
        to_agent: 'user',
        message_type: 'text',
        metadata: { role: 'assistant', phase: 'final' },
      }),
    ]
    expect(isThinkingProcessMessage(messages[0], null)).toBe(true)
    expect(isThinkingProcessMessage(messages[1], null)).toBe(false)
    const groups = groupMessagesForDisplay(messages, null)
    expect(groups.map((g) => g.type)).toEqual(['thinking_group', 'assistant_block'])
  })

  it('groups synthetic user text into thinking, real user stays user bubble', () => {
    const messages: ChatMessage[] = [
      msg({
        id: 10,
        content: '# SOUL.md\nx',
        created_at: 1,
        metadata: { role: 'user', source: 'gateway-history' },
      }),
      msg({
        id: 11,
        content: 'Let me read files',
        created_at: 2,
        from_agent: 'main',
        to_agent: 'user',
        message_type: 'status',
        metadata: { event: 'thinking', source: 'gateway-history' },
      }),
      msg({
        id: 12,
        content: '真人提问',
        created_at: 3,
        metadata: { role: 'user', source: 'gateway-history' },
      }),
    ]
    const groups = groupMessagesForDisplay(messages, null)
    expect(groups.map((g) => g.type)).toEqual(['thinking_group', 'user'])
    expect(groups[0].type === 'thinking_group' && groups[0].messages.map((m) => m.id)).toEqual([10, 11])
    expect(groups[1].type === 'user' && groups[1].messages[0].id).toBe(12)
  })
})

describe('shouldClearAwaitingReplyForMessage', () => {
  const baseState = {
    isAwaitingReply: true,
    awaitingConversationId: 'gw:agent:main:openai-user:star-office-web',
    awaitingRunId: 'run-1',
    currentUser: null,
  }

  it('clears on assistant text with role=assistant even if status is processing', () => {
    expect(
      shouldClearAwaitingReplyForMessage(baseState, {
        id: 1,
        conversation_id: 'gw:agent:main:openai-user:star-office-web',
        from_agent: 'main',
        to_agent: 'user',
        content: '你好',
        message_type: 'text',
        metadata: { role: 'assistant', status: 'processing', runId: 'run-1' },
        read_at: null,
        created_at: 1,
        workspace_id: 1,
      } as ChatMessage),
    ).toBe(true)
  })

  it('does not clear on gateway synthetic user tool JSON', () => {
    expect(
      shouldClearAwaitingReplyForMessage(baseState, {
        id: 2,
        conversation_id: 'gw:agent:main:openai-user:star-office-web',
        from_agent: 'user',
        to_agent: 'main',
        content: '{"status":"error","tool":"read","error":"ENOENT"}',
        message_type: 'text',
        metadata: { role: 'user', runId: 'run-1' },
        read_at: null,
        created_at: 2,
        workspace_id: 1,
      } as ChatMessage),
    ).toBe(false)
  })

  it('clears on assistant text even when runId mismatches forward.runId', () => {
    expect(
      shouldClearAwaitingReplyForMessage(baseState, {
        id: 3,
        conversation_id: 'gw:agent:main:openai-user:star-office-web',
        from_agent: 'main',
        to_agent: 'user',
        content: '终稿',
        message_type: 'text',
        metadata: { role: 'assistant', source: 'chat.history' },
        read_at: null,
        created_at: 3,
        workspace_id: 1,
      } as ChatMessage),
    ).toBe(true)
  })

  it('clears when DB mislabels assistant as role=user but phase=final (isUserChatMessage would block otherwise)', () => {
    expect(
      shouldClearAwaitingReplyForMessage(baseState, {
        id: 4,
        conversation_id: 'gw:agent:main:openai-user:star-office-web',
        from_agent: 'main',
        to_agent: 'user',
        content: '终稿',
        message_type: 'text',
        metadata: { role: 'user', phase: 'final', runId: 'run-1' },
        read_at: null,
        created_at: 4,
        workspace_id: 1,
      } as ChatMessage),
    ).toBe(true)
  })
})

describe('resolveOutgoingRecipient', () => {
  it('prefers explicit @mention target', () => {
    const result = resolveOutgoingRecipient({
      content: '@alpha 帮我看下',
      selectedAgent: 'coordinator',
      fallbackAgent: 'coordinator',
    })
    expect(result.to).toBe('alpha')
    expect(result.content).toBe('帮我看下')
  })

  it('falls back to selected agent', () => {
    const result = resolveOutgoingRecipient({
      content: '请处理这个任务',
      selectedAgent: 'research',
      fallbackAgent: 'coordinator',
    })
    expect(result.to).toBe('research')
    expect(result.content).toBe('请处理这个任务')
  })

  it('uses default fallback when no selection exists', () => {
    const result = resolveOutgoingRecipient({
      content: 'hello',
      selectedAgent: 'all',
      fallbackAgent: 'coordinator',
    })
    expect(result.to).toBe('coordinator')
  })
})
