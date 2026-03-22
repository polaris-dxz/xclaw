import { describe, expect, it } from 'vitest'

import {
  buildStudioBaseUrl,
  buildStudioEmbedUrl,
  buildStudioHealthUrl,
  normalizeStudioPort,
} from '../studio/runtime'

describe('studio runtime helpers', () => {
  it('uses default port when input is empty', () => {
    expect(normalizeStudioPort(undefined)).toBe(19101)
    expect(normalizeStudioPort('')).toBe(19101)
  })

  it('uses default port when input is invalid', () => {
    expect(normalizeStudioPort('abc')).toBe(19101)
    expect(normalizeStudioPort(-1)).toBe(19101)
    expect(normalizeStudioPort(0)).toBe(19101)
  })

  it('accepts valid custom port', () => {
    expect(normalizeStudioPort('3009')).toBe(3009)
    expect(normalizeStudioPort(42000)).toBe(42000)
  })

  it('builds base url and health url consistently', () => {
    const baseUrl = buildStudioBaseUrl('3009')
    expect(baseUrl).toBe('http://127.0.0.1:3009')
    expect(buildStudioHealthUrl(baseUrl)).toBe('http://127.0.0.1:3009/health')
  })

  it('builds embedded studio url to normal web page', () => {
    expect(buildStudioEmbedUrl('http://127.0.0.1:19101')).toBe(
      'http://127.0.0.1:19101/'
    )
    expect(buildStudioEmbedUrl('http://127.0.0.1:19101/')).toBe(
      'http://127.0.0.1:19101/'
    )
  })
})
