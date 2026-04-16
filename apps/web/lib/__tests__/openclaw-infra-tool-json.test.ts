import { describe, expect, it } from 'vitest'
import {
  formatOpenclawGatewayInfraForDisplay,
  matchAnyOpenclawGatewayInfraPayload,
  matchOpenclawConfigFileReadPayload,
  matchOpenclawSessionsListPayload,
} from '../chat-messages/openclaw-infra-tool-json'

describe('openclaw-infra-tool-json', () => {
  it('matches sessions_list style payload', () => {
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
    expect(matchOpenclawSessionsListPayload(raw)).toEqual({ count: 1, sessionCount: 1 })
    expect(matchAnyOpenclawGatewayInfraPayload(raw)).toBe('sessions')
    expect(formatOpenclawGatewayInfraForDisplay(raw)).toContain('会话列表')
  })

  it('matches openclaw.json read RPC shape', () => {
    const raw = JSON.stringify({
      ok: true,
      result: {
        path: '/Users/x/.xclaw/openclaw.json',
        exists: true,
        raw: '{"models":{"defaults":{"model":"m"}}}',
      },
    })
    expect(matchOpenclawConfigFileReadPayload(raw)).toEqual({ path: '/Users/x/.xclaw/openclaw.json' })
    expect(matchAnyOpenclawGatewayInfraPayload(raw)).toBe('config')
    expect(formatOpenclawGatewayInfraForDisplay(raw)).toContain('openclaw.json')
  })

  it('matches after leading client summary line', () => {
    const json = JSON.stringify({ ok: true, result: { path: '/p/openclaw.json', exists: true, raw: '{}' } })
    const combined = `已收到网关返回的会话列表（1 个会话，count=1）。此为系统数据，非聊天正文。\n${json}`
    expect(formatOpenclawGatewayInfraForDisplay(combined)).toContain('openclaw.json')
  })

  it('does not match arbitrary JSON', () => {
    expect(matchAnyOpenclawGatewayInfraPayload('{"result":"hello"}')).toBeNull()
  })

  it('matches config read JSON after untrusted-sender style prefix', () => {
    const json = JSON.stringify({
      ok: true,
      result: { path: '/Users/x/.xclaw/openclaw.json', exists: true, raw: '{}' },
    })
    const combined = `Sender (untrusted metadata):\n{"label":"cli"}\n[Mon 2026-04-14]\n\n${json}`
    expect(matchOpenclawConfigFileReadPayload(combined)).toEqual({ path: '/Users/x/.xclaw/openclaw.json' })
    expect(formatOpenclawGatewayInfraForDisplay(combined)).toContain('openclaw.json')
  })
})
