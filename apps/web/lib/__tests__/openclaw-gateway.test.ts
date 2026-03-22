import { describe, expect, it } from 'vitest'
import { parseGatewayJsonOutput, unwrapGatewayRpcResult } from '@/lib/openclaw-gateway'

describe('parseGatewayJsonOutput', () => {
  it('parses embedded object payloads', () => {
    expect(parseGatewayJsonOutput('warn\n{"status":"started","runId":"abc"}\n')).toEqual({
      status: 'started',
      runId: 'abc',
    })
  })

  it('parses embedded array payloads', () => {
    expect(parseGatewayJsonOutput('note\n[{"id":1},{"id":2}]')).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('returns null for non-json output', () => {
    expect(parseGatewayJsonOutput('plain text only')).toBeNull()
  })
})

describe('unwrapGatewayRpcResult', () => {
  it('unwraps CLI { result: { ok, key, entry } } shape', () => {
    const inner = { ok: true, key: 'agent:main:ui-test', entry: { label: '标题' } }
    expect(unwrapGatewayRpcResult({ result: inner })).toEqual(inner)
  })

  it('leaves flat payloads unchanged', () => {
    const flat = { status: 'started', runId: 'r1' }
    expect(unwrapGatewayRpcResult(flat)).toEqual(flat)
  })
})
