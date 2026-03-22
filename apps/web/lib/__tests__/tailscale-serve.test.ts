import { describe, expect, it } from 'vitest'
import { findTailscaleServePort, detectTailscaleServe, hasGwPathHandler } from '@/lib/tailscale-serve'

// Realistic Tailscale Serve status JSON matching the structure returned by
// `tailscale serve status --json`
const TYPICAL_WEB_CONFIG = {
  'myhost.tailb5729a.ts.net:8443': {
    Handlers: {
      '/': { Proxy: 'http://localhost:20064' },
    },
  },
  'myhost.tailb5729a.ts.net:8444': {
    Handlers: {
      '/': { Proxy: 'http://127.0.0.1:3000' },
    },
  },
  'myhost.tailb5729a.ts.net:3001': {
    Handlers: {
      '/': { Proxy: 'http://127.0.0.1:3002' },
    },
  },
}

const GW_PATH_WEB_CONFIG = {
  'myhost.tailb5729a.ts.net:443': {
    Handlers: {
      '/': { Proxy: 'http://127.0.0.1:3000' },
      '/gw': { Proxy: 'http://127.0.0.1:20064' },
    },
  },
}

describe('findTailscaleServePort', () => {
  it('finds the external port proxying to a given local port', () => {
    expect(findTailscaleServePort(TYPICAL_WEB_CONFIG, 20064)).toBe(8443)
    expect(findTailscaleServePort(TYPICAL_WEB_CONFIG, 3000)).toBe(8444)
    expect(findTailscaleServePort(TYPICAL_WEB_CONFIG, 3002)).toBe(3001)
  })

  it('returns null when no handler matches the target port', () => {
    expect(findTailscaleServePort(TYPICAL_WEB_CONFIG, 9999)).toBeNull()
  })

  it('returns null for null/undefined web config', () => {
    expect(findTailscaleServePort(null, 20064)).toBeNull()
    expect(findTailscaleServePort(undefined, 20064)).toBeNull()
  })

  it('returns null for empty web config', () => {
    expect(findTailscaleServePort({}, 20064)).toBeNull()
  })

  it('handles handlers without Proxy field', () => {
    const web = {
      'myhost.ts.net:443': {
        Handlers: {
          '/': { Path: '/var/www' },
        },
      },
    }
    expect(findTailscaleServePort(web, 3000)).toBeNull()
  })

  it('matches proxy URLs with trailing slash', () => {
    const web = {
      'myhost.ts.net:9000': {
        Handlers: {
          '/': { Proxy: 'http://127.0.0.1:4000/' },
        },
      },
    }
    expect(findTailscaleServePort(web, 4000)).toBe(9000)
  })

  it('does not match partial port numbers', () => {
    const web = {
      'myhost.ts.net:443': {
        Handlers: {
          '/': { Proxy: 'http://127.0.0.1:20064' },
        },
      },
    }
    // Port 2006 should not match a proxy to 20064
    expect(findTailscaleServePort(web, 2006)).toBeNull()
    // Port 64 should not match
    expect(findTailscaleServePort(web, 64)).toBeNull()
  })
})

describe('detectTailscaleServe', () => {
  it('detects /gw path-based proxy', () => {
    expect(detectTailscaleServe(GW_PATH_WEB_CONFIG)).toBe(true)
  })

  it('detects port-based proxy to gateway default port 20064', () => {
    expect(detectTailscaleServe(TYPICAL_WEB_CONFIG)).toBe(true)
  })

  it('returns false when no gateway proxy found', () => {
    const web = {
      'myhost.ts.net:3000': {
        Handlers: {
          '/': { Proxy: 'http://127.0.0.1:3000' },
        },
      },
    }
    expect(detectTailscaleServe(web)).toBe(false)
  })

  it('returns false for null/undefined web config', () => {
    expect(detectTailscaleServe(null)).toBe(false)
    expect(detectTailscaleServe(undefined)).toBe(false)
  })

  it('returns false for empty web config with no config path', () => {
    expect(detectTailscaleServe({})).toBe(false)
  })

  it('handles host entries with no Handlers', () => {
    const web = { 'myhost.ts.net:443': {} }
    expect(detectTailscaleServe(web)).toBe(false)
  })
})

describe('hasGwPathHandler', () => {
  it('returns true when /gw handler exists', () => {
    expect(hasGwPathHandler(GW_PATH_WEB_CONFIG)).toBe(true)
  })

  it('returns false when no /gw handler exists', () => {
    expect(hasGwPathHandler(TYPICAL_WEB_CONFIG)).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(hasGwPathHandler(null)).toBe(false)
    expect(hasGwPathHandler(undefined)).toBe(false)
  })
})
