import { describe, expect, it } from 'vitest'
import { parseGatewayHistoryTranscript } from '../transcript-parser'

describe('parseGatewayHistoryTranscript (gateway RPC shapes)', () => {
  it('parses assistant rows that use parts[] instead of content', () => {
    const messages = [
      {
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
      },
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hello from gateway parts.' }],
      },
    ]
    const out = parseGatewayHistoryTranscript(messages, 20)
    expect(out.length).toBeGreaterThanOrEqual(1)
    const lastAssistant = [...out].reverse().find((m) => m.role === 'assistant')
    expect(lastAssistant?.parts.some((p) => p.type === 'text' && p.text.includes('Hello from gateway'))).toBe(
      true,
    )
  })
})
