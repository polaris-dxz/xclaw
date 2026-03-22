/**
 * 个人微信 ilink 扫码：与 extensions/weixin 中 login-qr 逻辑对齐，
 * 在 Next.js 进程内直连 ilink，避免依赖 openclaw gateway WebSocket（易 1006 断开）。
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'

import { config } from '@/lib/config'
import { REMOTE_CHANNEL_LABELS } from '@/lib/remote-channel-labels'

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const DEFAULT_BOT_TYPE = '3'
const QR_LONG_POLL_TIMEOUT_MS = 35_000
const ACTIVE_LOGIN_TTL_MS = 5 * 60_000
const MAX_QR_REFRESH_COUNT = 3

type ActiveLogin = {
  sessionKey: string
  qrcode: string
  qrcodeUrl: string
  startedAt: number
  apiBaseUrl: string
  botType: string
}

const activeLogins = new Map<string, ActiveLogin>()

function isFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS
}

function purgeExpired(): void {
  for (const [k, login] of activeLogins) {
    if (!isFresh(login)) activeLogins.delete(k)
  }
}

function normalizeWeixinAccountId(raw: string): string {
  const t = raw.trim().toLowerCase()
  const s = t.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/, '').replace(/-+$/, '')
  return s.slice(0, 64) || 'default'
}

function loadRouteTagFromConfig(): string | undefined {
  const configPath = config.openclawConfigPath
  if (!configPath || !fs.existsSync(configPath)) return undefined
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const cfg = JSON.parse(raw) as Record<string, unknown>
    const section = (cfg.channels as Record<string, unknown> | undefined)?.['weixin'] as
      | Record<string, unknown>
      | undefined
    if (!section) return undefined
    if (typeof section.routeTag === 'number') return String(section.routeTag)
    if (typeof section.routeTag === 'string' && section.routeTag.trim()) return section.routeTag.trim()
    const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined
    if (accounts) {
      for (const acc of Object.values(accounts)) {
        const tag = acc?.routeTag
        if (typeof tag === 'number') return String(tag)
        if (typeof tag === 'string' && tag.trim()) return tag.trim()
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

export function resolveWeixinIlinkBaseUrl(): string {
  const configPath = config.openclawConfigPath
  if (!configPath || !fs.existsSync(configPath)) return DEFAULT_BASE_URL
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const cfg = JSON.parse(raw) as Record<string, unknown>
    const section = (cfg.channels as Record<string, unknown> | undefined)?.['weixin'] as
      | Record<string, unknown>
      | undefined
    if (!section) return DEFAULT_BASE_URL
    const accounts = section.accounts as Record<string, { baseUrl?: string }> | undefined
    if (accounts) {
      for (const acc of Object.values(accounts)) {
        const u = acc?.baseUrl?.trim()
        if (u) return u
      }
    }
    const top = typeof section.baseUrl === 'string' ? section.baseUrl.trim() : ''
    if (top) return top
  } catch {
    // ignore
  }
  return DEFAULT_BASE_URL
}

async function fetchQRCode(apiBaseUrl: string, botType: string): Promise<{ qrcode: string; qrcode_img_content: string }> {
  const base = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`, base)
  const headers: Record<string, string> = {}
  const routeTag = loadRouteTagFromConfig()
  if (routeTag) headers.SKRouteTag = routeTag

  const response = await fetch(url.toString(), { headers })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`ilink get_bot_qrcode failed: ${response.status} ${body.slice(0, 200)}`)
  }
  return (await response.json()) as { qrcode: string; qrcode_img_content: string }
}

async function pollQRStatus(apiBaseUrl: string, qrcode: string): Promise<{
  status: 'wait' | 'scaned' | 'confirmed' | 'expired'
  bot_token?: string
  ilink_bot_id?: string
  baseurl?: string
  ilink_user_id?: string
}> {
  const base = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base)
  const headers: Record<string, string> = { 'iLink-App-ClientVersion': '1' }
  const routeTag = loadRouteTagFromConfig()
  if (routeTag) headers.SKRouteTag = routeTag

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), QR_LONG_POLL_TIMEOUT_MS)
  try {
    const response = await fetch(url.toString(), { headers, signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) {
      const rawText = await response.text().catch(() => '')
      throw new Error(`ilink get_qrcode_status failed: ${response.status} ${rawText.slice(0, 200)}`)
    }
    return (await response.json()) as {
      status: 'wait' | 'scaned' | 'confirmed' | 'expired'
      bot_token?: string
      ilink_bot_id?: string
      baseurl?: string
      ilink_user_id?: string
    }
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' }
    }
    throw err
  }
}

export type WeixinQrStartResult = {
  qrPayload: string
  sessionKey: string
  message: string
}

export async function startWeixinIlinkQr(): Promise<WeixinQrStartResult> {
  purgeExpired()
  const apiBaseUrl = resolveWeixinIlinkBaseUrl()
  const sessionKey = randomUUID()
  const botType = DEFAULT_BOT_TYPE

  const qrResponse = await fetchQRCode(apiBaseUrl, botType)
  const login: ActiveLogin = {
    sessionKey,
    qrcode: qrResponse.qrcode,
    qrcodeUrl: qrResponse.qrcode_img_content,
    startedAt: Date.now(),
    apiBaseUrl,
    botType,
  }
  activeLogins.set(sessionKey, login)

  return {
    qrPayload: qrResponse.qrcode_img_content,
    sessionKey,
    message: '使用微信扫描以下二维码，以完成连接。',
  }
}

async function bumpWeixinAccountsUpdatedAt(): Promise<void> {
  const configPath = config.openclawConfigPath
  if (!configPath) return
  try {
    const raw = await readFile(configPath, 'utf-8')
    const cfg = JSON.parse(raw) as Record<string, unknown>
    const channels = (cfg.channels ?? {}) as Record<string, unknown>
    cfg.channels = channels
    const section = (channels['weixin'] ?? {}) as Record<string, unknown>
    channels['weixin'] = section
    section._accountsUpdatedAt = Date.now()
    await writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n')
  } catch {
    // ignore
  }
}

async function persistWeixinLogin(params: {
  accountIdRaw: string
  botToken?: string
  baseUrl?: string
  userId?: string
}): Promise<void> {
  const stateDir = config.openclawStateDir
  if (!stateDir) return

  const accountId = normalizeWeixinAccountId(params.accountIdRaw)
  const weixinDir = path.join(stateDir, 'weixin')
  const accountsDir = path.join(weixinDir, 'accounts')
  fs.mkdirSync(accountsDir, { recursive: true })

  const token = params.botToken?.trim()
  const baseUrl = params.baseUrl?.trim() || resolveWeixinIlinkBaseUrl()
  const userId = params.userId?.trim()

  const data: Record<string, unknown> = {}
  if (token) {
    data.token = token
    data.savedAt = new Date().toISOString()
  }
  if (baseUrl) data.baseUrl = baseUrl
  if (userId) data.userId = userId

  const filePath = path.join(accountsDir, `${accountId}.json`)
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    // ignore
  }

  const indexPath = path.join(weixinDir, 'accounts.json')
  let ids: string[] = []
  try {
    if (fs.existsSync(indexPath)) {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as unknown
      if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string')
    }
  } catch {
    ids = []
  }
  if (!ids.includes(accountId)) {
    ids.push(accountId)
    await writeFile(indexPath, JSON.stringify(ids, null, 2), 'utf-8')
  }

  const configPath = config.openclawConfigPath
  if (configPath) {
    try {
      const raw = await readFile(configPath, 'utf-8')
      const cfg = JSON.parse(raw) as Record<string, unknown>
      if (!cfg.channels || typeof cfg.channels !== 'object') cfg.channels = {}
      const channels = cfg.channels as Record<string, unknown>
      const prev = (channels.weixin as Record<string, unknown>) || {}
      channels.weixin = {
        ...prev,
        enabled: true,
        label: REMOTE_CHANNEL_LABELS.weixin,
      }
      await writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n')
    } catch {
      // ignore
    }
  }

  await bumpWeixinAccountsUpdatedAt()
}

export type WeixinQrWaitResult = {
  connected: boolean
  message: string
}

export async function waitWeixinIlinkQr(sessionKey: string, timeoutMs = 480_000): Promise<WeixinQrWaitResult> {
  purgeExpired()
  let activeLogin = activeLogins.get(sessionKey)

  if (!activeLogin) {
    return { connected: false, message: '当前没有进行中的登录，请先获取二维码。' }
  }

  if (!isFresh(activeLogin)) {
    activeLogins.delete(sessionKey)
    return { connected: false, message: '二维码已过期，请重新获取。' }
  }

  const deadline = Date.now() + Math.max(timeoutMs, 1000)
  let qrRefreshCount = 1

  while (Date.now() < deadline) {
    try {
      const statusResponse = await pollQRStatus(activeLogin.apiBaseUrl, activeLogin.qrcode)
      activeLogin = activeLogins.get(sessionKey) ?? activeLogin

      switch (statusResponse.status) {
        case 'wait':
          break
        case 'scaned':
          break
        case 'expired': {
          qrRefreshCount++
          if (qrRefreshCount > MAX_QR_REFRESH_COUNT) {
            activeLogins.delete(sessionKey)
            return { connected: false, message: '登录超时：二维码多次过期，请重新开始。' }
          }
          try {
            const qrResponse = await fetchQRCode(activeLogin.apiBaseUrl, activeLogin.botType)
            activeLogin.qrcode = qrResponse.qrcode
            activeLogin.qrcodeUrl = qrResponse.qrcode_img_content
            activeLogin.startedAt = Date.now()
            activeLogins.set(sessionKey, activeLogin)
          } catch (refreshErr) {
            activeLogins.delete(sessionKey)
            return { connected: false, message: `刷新二维码失败: ${String(refreshErr)}` }
          }
          break
        }
        case 'confirmed': {
          if (!statusResponse.ilink_bot_id) {
            activeLogins.delete(sessionKey)
            return { connected: false, message: '登录失败：服务器未返回 ilink_bot_id。' }
          }
          activeLogins.delete(sessionKey)
          await persistWeixinLogin({
            accountIdRaw: statusResponse.ilink_bot_id,
            botToken: statusResponse.bot_token,
            baseUrl: statusResponse.baseurl,
            userId: statusResponse.ilink_user_id,
          })
          return { connected: true, message: '与微信连接成功。' }
        }
        default:
          break
      }
    } catch (err) {
      activeLogins.delete(sessionKey)
      return { connected: false, message: `登录失败: ${String(err)}` }
    }
  }

  activeLogins.delete(sessionKey)
  return { connected: false, message: '登录超时，请重试。' }
}
