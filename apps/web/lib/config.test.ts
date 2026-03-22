import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadConfigWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules()

  const original = {
    XCLAW_DATA_DIR: process.env.XCLAW_DATA_DIR,
    XCLAW_BUILD_DATA_DIR: process.env.XCLAW_BUILD_DATA_DIR,
    XCLAW_BUILD_DB_PATH: process.env.XCLAW_BUILD_DB_PATH,
    XCLAW_BUILD_TOKENS_PATH: process.env.XCLAW_BUILD_TOKENS_PATH,
    XCLAW_DB_PATH: process.env.XCLAW_DB_PATH,
    XCLAW_TOKENS_PATH: process.env.XCLAW_TOKENS_PATH,
    NEXT_PHASE: process.env.NEXT_PHASE,
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  const mod = await import('./config')

  if (original.XCLAW_DATA_DIR === undefined) delete process.env.XCLAW_DATA_DIR
  else process.env.XCLAW_DATA_DIR = original.XCLAW_DATA_DIR

  if (original.XCLAW_BUILD_DATA_DIR === undefined) delete process.env.XCLAW_BUILD_DATA_DIR
  else process.env.XCLAW_BUILD_DATA_DIR = original.XCLAW_BUILD_DATA_DIR

  if (original.XCLAW_BUILD_DB_PATH === undefined) delete process.env.XCLAW_BUILD_DB_PATH
  else process.env.XCLAW_BUILD_DB_PATH = original.XCLAW_BUILD_DB_PATH

  if (original.XCLAW_BUILD_TOKENS_PATH === undefined) delete process.env.XCLAW_BUILD_TOKENS_PATH
  else process.env.XCLAW_BUILD_TOKENS_PATH = original.XCLAW_BUILD_TOKENS_PATH

  if (original.XCLAW_DB_PATH === undefined) delete process.env.XCLAW_DB_PATH
  else process.env.XCLAW_DB_PATH = original.XCLAW_DB_PATH

  if (original.XCLAW_TOKENS_PATH === undefined) delete process.env.XCLAW_TOKENS_PATH
  else process.env.XCLAW_TOKENS_PATH = original.XCLAW_TOKENS_PATH

  if (original.NEXT_PHASE === undefined) delete process.env.NEXT_PHASE
  else process.env.NEXT_PHASE = original.NEXT_PHASE

  return mod.config
}

describe('config data paths', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('derives db and token paths from XCLAW_DATA_DIR', async () => {
    const config = await loadConfigWithEnv({
      XCLAW_DATA_DIR: '/tmp/xclaw-data',
      XCLAW_DB_PATH: undefined,
      XCLAW_TOKENS_PATH: undefined,
    })

    expect(config.dataDir).toBe('/tmp/xclaw-data')
    expect(config.dbPath).toBe('/tmp/xclaw-data/xclaw.db')
    expect(config.tokensPath).toBe('/tmp/xclaw-data/xclaw-tokens.json')
  })

  it('respects explicit db and token path overrides', async () => {
    const config = await loadConfigWithEnv({
      XCLAW_DATA_DIR: '/tmp/xclaw-data',
      XCLAW_DB_PATH: '/tmp/custom.db',
      XCLAW_TOKENS_PATH: '/tmp/custom-tokens.json',
    })

    expect(config.dataDir).toBe('/tmp/xclaw-data')
    expect(config.dbPath).toBe('/tmp/custom.db')
    expect(config.tokensPath).toBe('/tmp/custom-tokens.json')
  })

  it('uses a build-scoped worker data dir during next build', async () => {
    const config = await loadConfigWithEnv({
      NEXT_PHASE: 'phase-production-build',
      XCLAW_DATA_DIR: '/tmp/runtime-data',
      XCLAW_BUILD_DATA_DIR: '/tmp/build-scratch',
      XCLAW_DB_PATH: undefined,
      XCLAW_TOKENS_PATH: undefined,
    })

    expect(config.dataDir).toMatch(/^\/tmp\/build-scratch\/worker-\d+$/)
    expect(config.dbPath).toMatch(/^\/tmp\/build-scratch\/worker-\d+\/xclaw\.db$/)
    expect(config.tokensPath).toMatch(/^\/tmp\/build-scratch\/worker-\d+\/xclaw-tokens\.json$/)
  })

  it('prefers build-specific db and token overrides during next build', async () => {
    const config = await loadConfigWithEnv({
      NEXT_PHASE: 'phase-production-build',
      XCLAW_DATA_DIR: '/tmp/runtime-data',
      XCLAW_DB_PATH: '/tmp/runtime.db',
      XCLAW_TOKENS_PATH: '/tmp/runtime-tokens.json',
      XCLAW_BUILD_DB_PATH: '/tmp/build.db',
      XCLAW_BUILD_TOKENS_PATH: '/tmp/build-tokens.json',
    })

    const expectedBuildRoot = path.join(os.tmpdir(), 'xclaw-build')
    expect(config.dataDir).toMatch(new RegExp(`^${expectedBuildRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/worker-\\d+$`))
    expect(config.dbPath).toBe('/tmp/build.db')
    expect(config.tokensPath).toBe('/tmp/build-tokens.json')
  })
})
