import { describe, expect, it } from 'vitest'
import {
  openclawEventJsonStringForTranscriptRow,
  openclawMessageLine,
  parseOpenclawEventJson,
  stringifyOpenclawEventLine,
} from '../chat-messages/openclaw-event-shape'
import { parseJsonlTranscript } from '../transcript-parser'

describe('openclaw-event-shape', () => {
  it('builds message lines compatible with parseJsonlTranscript', () => {
    const line = stringifyOpenclawEventLine(openclawMessageLine('user', 'hello', '2026-01-01T00:00:00.000Z'))
    const parsed = parseJsonlTranscript(line, 10)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].rawJsonlLine).toBe(line)
    expect(parsed[0].parts[0]).toMatchObject({ type: 'text', text: 'hello' })
  })

  it('uses raw jsonl line for DB column when transcript carries rawJsonlLine', () => {
    const raw =
      '{"type":"message","timestamp":"2026-01-02T00:00:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"x"}]}}'
    const parsed = parseJsonlTranscript(raw, 10)
    expect(parsed[0].rawJsonlLine).toBe(raw)
    const part = parsed[0].parts.find((p) => p.type === 'text')!
    const stored = openclawEventJsonStringForTranscriptRow(parsed[0], part)
    expect(stored).toBe(raw)
  })

  it('parses stored column JSON to object', () => {
    const s = stringifyOpenclawEventLine(openclawMessageLine('assistant', 'ok'))
    expect(parseOpenclawEventJson(s)?.type).toBe('message')
  })
})
