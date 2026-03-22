import { describe, expect, it } from 'vitest'
import { buildXClawCsp, buildNonceRequestHeaders } from '../csp'

describe('buildXClawCsp', () => {
  it('includes the request nonce in script and style directives', () => {
    const csp = buildXClawCsp({ nonce: 'nonce-123', googleEnabled: false })

    expect(csp).toContain(`script-src 'self' 'nonce-nonce-123' 'strict-dynamic'`)
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src-elem 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src-attr 'unsafe-inline'")
    expect(csp).toContain("frame-src 'self' http://127.0.0.1:* http://localhost:*")
  })

  it('allows unsafe-eval in development for React debug tooling', () => {
    const originalEnv = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'development'
      const csp = buildXClawCsp({ nonce: 'nonce-123', googleEnabled: false })
      expect(csp).toContain(`script-src 'self' 'nonce-nonce-123' 'strict-dynamic' 'unsafe-eval' blob:`)
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })

  it('does not allow unsafe-eval in production', () => {
    const originalEnv = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      const csp = buildXClawCsp({ nonce: 'nonce-123', googleEnabled: false })
      expect(csp).not.toContain(`'unsafe-eval'`)
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })
})

describe('buildNonceRequestHeaders', () => {
  it('propagates nonce and CSP into request headers for Next.js rendering', () => {
    const headers = buildNonceRequestHeaders({
      headers: new Headers({ host: 'localhost:3000' }),
      nonce: 'nonce-123',
      googleEnabled: false,
    })

    expect(headers.get('x-nonce')).toBe('nonce-123')
    expect(headers.get('Content-Security-Policy')).toContain("style-src 'self' 'unsafe-inline'")
  })
})
