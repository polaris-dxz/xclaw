import { describe, expect, it } from 'vitest'
import {
  isUntrustedSenderEnvelopeContent,
  stripUntrustedSenderMetadataEnvelope,
} from '../chat-messages/untrusted-sender-envelope'

describe('untrusted-sender-envelope', () => {
  it('detects OpenClaw CLI envelope', () => {
    const raw = `Sender (untrusted metadata):
{"label":"cli","id":"cli"}
[Mon 2026-04-13 16:32 GMT+8] 你好`
    expect(isUntrustedSenderEnvelopeContent(raw)).toBe(true)
    expect(stripUntrustedSenderMetadataEnvelope(raw)).toBe('你好')
  })

  it('strips trailing placeholder phrase', () => {
    const raw = `Sender (untrusted metadata):
{"label":"cli"}
[Mon 2026-04-13 16:32 GMT+8] 你好 user 发送的消息`
    expect(stripUntrustedSenderMetadataEnvelope(raw)).toBe('你好')
  })

  it('leaves normal user text unchanged', () => {
    expect(stripUntrustedSenderMetadataEnvelope('plain hello')).toBe('plain hello')
  })

  it('strips leading cli JSON + bracket timestamp without Sender header', () => {
    const raw = `{
  "label": "cli",
  "id": "cli"
}
[Mon 2026-04-13 18:47 GMT+8] 我服了`
    expect(stripUntrustedSenderMetadataEnvelope(raw)).toBe('我服了')
  })

  it('balances braces across multiline JSON (not non-greedy first })', () => {
    const raw = `{
  "label": "cli",
  "id": "cli"
}
[Mon 2026-04-13 21:41 GMT+8] 你回复的不对吧`
    expect(stripUntrustedSenderMetadataEnvelope(raw)).toBe('你回复的不对吧')
  })

  it('returns empty when timestamp line has no body after ]', () => {
    const raw = `Sender (untrusted metadata):
{"label":"cli","id":"cli"}
[Mon 2026-04-13 19:51 GMT+8]`
    expect(stripUntrustedSenderMetadataEnvelope(raw)).toBe('')
  })
})
