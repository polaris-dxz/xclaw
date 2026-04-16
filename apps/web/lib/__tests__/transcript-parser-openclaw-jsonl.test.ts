import { describe, expect, it } from 'vitest'
import { parseJsonlTranscript } from '../transcript-parser'

describe('OpenClaw session jsonl (agents/.../sessions/*.jsonl)', () => {
  it('uses top-level entry.role when message.role is missing (toolResult)', () => {
    const line = JSON.stringify({
      type: 'message',
      id: '314d6e4b',
      parentId: 'bdb374d2',
      timestamp: '2026-04-14T03:01:36.460Z',
      role: 'toolResult',
      message: {
        toolCallId: 'call_function_oked23mjma8f_1',
        toolName: 'web_search',
        content: [{ type: 'text', text: '{"error":"missing_brave_api_key"}' }],
      },
    })
    const out = parseJsonlTranscript(`${line}\n`, 10)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('assistant')
    expect(out[0].parts).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'call_function_oked23mjma8f_1',
        content: '{"error":"missing_brave_api_key"}',
        isError: false,
      },
    ])
  })

  it('maps role:"toolResult" to assistant + tool_result part (not user text)', () => {
    const line = JSON.stringify({
      type: 'message',
      id: '2127fe47',
      parentId: '4c1cf99d',
      timestamp: '2026-04-14T03:01:40.656Z',
      message: {
        role: 'toolResult',
        toolCallId: 'call_function_nm4vt1bd4gp5_1',
        toolName: 'web_fetch',
        content: [{ type: 'text', text: '{"url":"https://movie.douban.com/subject/1/","status":200}' }],
      },
    })
    const out = parseJsonlTranscript(`${line}\n`, 10)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('assistant')
    expect(out[0].parts).toEqual([
      {
        type: 'tool_result',
        toolUseId: 'call_function_nm4vt1bd4gp5_1',
        content: '{"url":"https://movie.douban.com/subject/1/","status":200}',
        isError: false,
      },
    ])
  })

  it('parses assistant content blocks with type toolCall as tool_use', () => {
    const line = JSON.stringify({
      type: 'message',
      id: 'e4c21931',
      timestamp: '2026-04-13T10:25:41.395Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'fetch weather' },
          {
            type: 'toolCall',
            id: 'call_271b873c3aeb4d509c5cf022',
            name: 'web_fetch',
            arguments: { maxChars: 5000, url: 'https://weather.com/x' },
          },
        ],
      },
    })
    const out = parseJsonlTranscript(`${line}\n`, 10)
    expect(out).toHaveLength(1)
    expect(out[0].role).toBe('assistant')
    const tool = out[0].parts.find((p) => p.type === 'tool_use')
    expect(tool).toMatchObject({
      type: 'tool_use',
      id: 'call_271b873c3aeb4d509c5cf022',
      name: 'web_fetch',
      input: expect.stringContaining('weather.com'),
    })
  })

})
