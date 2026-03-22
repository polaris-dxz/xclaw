import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '@/lib/config'

/**
 * Resolves the on-disk openclaw.json path for xclaw / OpenClaw runtime.
 * Prefers explicit env, then ~/.xclaw if present, then ~/.openclaw, then ~/.xclaw for new files.
 */
export function resolveWritableOpenClawConfigPath(): string {
  const explicit =
    process.env.OPENCLAW_CONFIG_PATH?.trim() || process.env.XCLAW_OPENCLAW_CONFIG_PATH?.trim()
  if (explicit) return explicit
  const home = os.homedir()
  const xclawPath = path.join(home, '.xclaw', 'openclaw.json')
  const openclawPath = path.join(home, '.openclaw', 'openclaw.json')
  if (fs.existsSync(xclawPath)) return xclawPath
  if (fs.existsSync(openclawPath)) return openclawPath
  if (config.openclawConfigPath && fs.existsSync(config.openclawConfigPath)) {
    return config.openclawConfigPath
  }
  return xclawPath
}
