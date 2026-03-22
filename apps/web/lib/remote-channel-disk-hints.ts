/**
 * When the gateway is unreachable or has not yet reported channel status, derive
 * "configured" hints from the local openclaw.json so the 远控通道 UI can show 已配置.
 */
import fs from 'node:fs'
import path from 'node:path'

import { config } from '@/lib/config'
import { REMOTE_CHANNEL_LABELS } from '@/lib/remote-channel-labels'

/** True if Weixin QR login has produced account data under OPENCLAW_STATE_DIR (same as gateway). */
function hasWeixinLinkedAccounts(stateDir: string): boolean {
  if (!stateDir) return false
  try {
    const indexPath = path.join(stateDir, 'weixin', 'accounts.json')
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf8')
      const arr = JSON.parse(raw) as unknown
      if (Array.isArray(arr) && arr.length > 0) return true
    }
    const legacy = path.join(stateDir, 'credentials', 'weixin', 'credentials.json')
    if (fs.existsSync(legacy)) {
      const raw = fs.readFileSync(legacy, 'utf8')
      const p = JSON.parse(raw) as { token?: string }
      if (typeof p.token === 'string' && p.token.trim()) return true
    }
    const accDir = path.join(stateDir, 'weixin', 'accounts')
    if (fs.existsSync(accDir)) {
      const files = fs.readdirSync(accDir).filter((f) => f.endsWith('.json'))
      for (const f of files) {
        const raw = fs.readFileSync(path.join(accDir, f), 'utf8')
        const p = JSON.parse(raw) as { token?: string }
        if (typeof p.token === 'string' && p.token.trim()) return true
      }
    }
  } catch {
    // ignore
  }
  return false
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

/** Returns channel keys that appear configured on disk (credentials + plugin not disabled). */
export function readRemoteChannelDiskHints(): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  const configPath = config.openclawConfigPath
  if (!configPath || !fs.existsSync(configPath)) return out

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>
  } catch {
    return out
  }

  const channels = asRecord(parsed.channels) ?? {}
  const plugins = asRecord(parsed.plugins) ?? {}
  const entries = asRecord(plugins.entries) ?? {}

  const qq = asRecord(channels.qqbot)
  const qqPlugin = asRecord(entries['openclaw-qqbot'])
  const qqHasSecret =
    (typeof qq?.clientSecret === 'string' && qq.clientSecret.trim()) ||
    (typeof qq?.clientSecretFile === 'string' && String(qq.clientSecretFile).trim())
  if (
    qq?.enabled !== false &&
    typeof qq?.appId === 'string' &&
    qq.appId.trim() &&
    qqHasSecret &&
    qqPlugin?.enabled !== false
  ) {
    out.qqbot = true
  }

  const wecom = asRecord(channels.wecom)
  const wecomPlugin = asRecord(entries['wecom-openclaw-plugin'])
  if (wecomPlugin?.enabled !== false) {
    const hasWsCreds =
      typeof wecom?.botId === 'string' &&
      wecom.botId.trim() &&
      typeof wecom?.secret === 'string' &&
      wecom.secret.trim()
    if (hasWsCreds) out.wecom = true
  }

  const feishu = asRecord(channels.feishu)
  if (
    typeof feishu?.appId === 'string' &&
    feishu.appId.trim() &&
    typeof feishu?.appSecret === 'string' &&
    feishu.appSecret.trim()
  ) {
    out.feishu = true
  }

  const ding = asRecord(channels['dingtalk-connector'])
  const dingPlugin = asRecord(entries['dingtalk-connector'])
  if (
    typeof ding?.clientId === 'string' &&
    ding.clientId.trim() &&
    typeof ding?.clientSecret === 'string' &&
    ding.clientSecret.trim() &&
    dingPlugin?.enabled !== false
  ) {
    out['dingtalk-connector'] = true
  }

  const weixinPlugin = asRecord(entries['openclaw-weixin'])
  const weixinCh = asRecord(channels.weixin)
  const weixinLabelOk =
    typeof weixinCh?.label === 'string' && weixinCh.label.trim() === REMOTE_CHANNEL_LABELS.weixin
  if (
    weixinCh?.enabled !== false &&
    weixinPlugin?.enabled !== false &&
    (hasWeixinLinkedAccounts(config.openclawStateDir) || weixinLabelOk)
  ) {
    out.weixin = true
  }

  const wechatAccess = asRecord(channels['wechat-access'])
  const wechatAccessPlugin = asRecord(entries['wechat-access'])
  const waToken =
    (typeof wechatAccess?.token === 'string' && wechatAccess.token.trim()) ||
    (() => {
      const acc = asRecord(wechatAccess?.accounts as unknown)
      if (!acc) return ''
      for (const v of Object.values(acc)) {
        const row = asRecord(v)
        const t = row?.token
        if (typeof t === 'string' && t.trim()) return t
      }
      return ''
    })()
  if (
    wechatAccessPlugin?.enabled !== false &&
    wechatAccess?.enabled !== false &&
    Boolean(waToken)
  ) {
    out['wechat-access'] = true
  }

  return out
}

/** Minimal channel row for UI when gateway did not return this channel (offline / RPC failed). */
export function createDiskHintChannelStatus(): {
  configured: boolean
  running: boolean
  linked: boolean
  connected: boolean
  lastConnectedAt: null
  lastMessageAt: null
  lastStartAt: null
  lastError: null
  authAgeMs: null
  mode: null
  baseUrl: null
  publicKey: null
  probe: null
  profile: null
} {
  return {
    configured: true,
    running: false,
    linked: false,
    connected: false,
    lastConnectedAt: null,
    lastMessageAt: null,
    lastStartAt: null,
    lastError: null,
    authAgeMs: null,
    mode: null,
    baseUrl: null,
    publicKey: null,
    probe: null,
    profile: null,
  }
}

