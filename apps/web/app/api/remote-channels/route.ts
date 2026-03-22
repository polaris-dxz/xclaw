import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { validateBody } from '@/lib/validation'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'
import { mutationLimiter } from '@/lib/rate-limit'
import { logAuditEvent } from '@/lib/db'
import { REMOTE_CHANNEL_LABELS, type RemoteChannelBindPlatform } from '@/lib/remote-channel-labels'

const configureSchema = z
  .object({
    platform: z.enum(['qq', 'wecom', 'feishu', 'dingtalk', 'weixin', 'wechat_access']),
    appId: z.string().optional(),
    clientSecret: z.string().optional(),
    botId: z.string().optional(),
    secret: z.string().optional(),
    appSecret: z.string().optional(),
    clientId: z.string().optional(),
    /** 腾讯通路 / 微信客服插件（wechat-access） */
    token: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.platform === 'qq') {
      if (!data.appId?.trim()) ctx.addIssue({ code: 'custom', message: '请填写 App ID', path: ['appId'] })
      if (!data.clientSecret?.trim()) ctx.addIssue({ code: 'custom', message: '请填写 App Secret', path: ['clientSecret'] })
    }
    if (data.platform === 'wecom') {
      if (!data.botId?.trim()) ctx.addIssue({ code: 'custom', message: '请填写 Bot ID', path: ['botId'] })
      if (!data.secret?.trim()) ctx.addIssue({ code: 'custom', message: '请填写 Secret', path: ['secret'] })
    }
    if (data.platform === 'wechat_access') {
      if (!data.token?.trim()) ctx.addIssue({ code: 'custom', message: '请填写腾讯通路 Token', path: ['token'] })
    }
    if (data.platform === 'feishu') {
      if (!data.appId?.trim()) ctx.addIssue({ code: 'custom', message: '请填写 App ID', path: ['appId'] })
      if (!data.appSecret?.trim()) ctx.addIssue({ code: 'custom', message: '请填写 App Secret', path: ['appSecret'] })
    }
    if (data.platform === 'dingtalk') {
      if (!data.clientId?.trim()) ctx.addIssue({ code: 'custom', message: '请填写 Client ID', path: ['clientId'] })
      if (!data.clientSecret?.trim()) ctx.addIssue({ code: 'custom', message: '请填写 Client Secret', path: ['clientSecret'] })
    }
  })

const unbindSchema = z.object({
  platform: z.enum(['qq', 'wecom', 'feishu', 'dingtalk', 'weixin', 'wechat_access']),
})

function gatewayUrl(path: string): string {
  return `http://${config.gatewayHost}:${config.gatewayPort}${path}`
}

function gatewayHeaders(): Record<string, string> {
  const token = getDetectedGatewayToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function applyGatewayConfig(): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)
  try {
    await fetch(gatewayUrl('/api/config/apply'), {
      method: 'POST',
      signal: controller.signal,
      headers: gatewayHeaders(),
    })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * POST /api/remote-channels — merge OpenClaw channel + plugin entries for 远控通道
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, configureSchema)
  if ('error' in result) return result.error
  const body = result.data

  const configPath = config.openclawConfigPath
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
  }

  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Config file not found', path: configPath }, { status: 404 })
    }
    return NextResponse.json({ error: `Failed to read config: ${err?.message || err}` }, { status: 500 })
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in openclaw.json' }, { status: 500 })
  }

  if (!parsed.plugins || typeof parsed.plugins !== 'object') {
    parsed.plugins = {}
  }
  const plugins = parsed.plugins as Record<string, unknown>
  if (!plugins.entries || typeof plugins.entries !== 'object') {
    plugins.entries = {}
  }
  const entries = plugins.entries as Record<string, unknown>

  const ensurePluginAllowed = (pluginId: string) => {
    const allow = plugins.allow
    if (!Array.isArray(allow)) {
      const entryKeys =
        plugins.entries && typeof plugins.entries === 'object'
          ? Object.keys(plugins.entries as Record<string, unknown>)
          : []
      plugins.allow = [...new Set([...entryKeys, pluginId])]
      return
    }
    const ids = allow.map((x) => String(x))
    if (!ids.includes(pluginId)) {
      plugins.allow = [...ids, pluginId]
    }
  }

  if (!parsed.channels || typeof parsed.channels !== 'object') {
    parsed.channels = {}
  }
  const channels = parsed.channels as Record<string, unknown>

  try {
    switch (body.platform) {
      case 'qq': {
        ensurePluginAllowed('openclaw-qqbot')
        entries['openclaw-qqbot'] = { ...(entries['openclaw-qqbot'] as object), enabled: true }
        const prev = (channels.qqbot as Record<string, unknown>) || {}
        channels.qqbot = {
          ...prev,
          enabled: true,
          label: REMOTE_CHANNEL_LABELS.qq,
          appId: body.appId!,
          clientSecret: body.clientSecret!,
          allowFrom: Array.isArray(prev.allowFrom) ? prev.allowFrom : ['*'],
        }
        break
      }
      case 'wecom': {
        ensurePluginAllowed('wecom-openclaw-plugin')
        entries['wecom-openclaw-plugin'] = { ...(entries['wecom-openclaw-plugin'] as object), enabled: true }
        const prev = (channels.wecom as Record<string, unknown>) || {}
        channels.wecom = {
          ...prev,
          enabled: true,
          label: REMOTE_CHANNEL_LABELS.wecom,
          botId: body.botId!.trim(),
          secret: body.secret!.trim(),
        }
        break
      }
      case 'feishu': {
        const prev = (channels.feishu as Record<string, unknown>) || {}
        channels.feishu = {
          ...prev,
          enabled: true,
          label: REMOTE_CHANNEL_LABELS.feishu,
          appId: body.appId!,
          appSecret: body.appSecret!,
        }
        break
      }
      case 'dingtalk': {
        ensurePluginAllowed('dingtalk-connector')
        entries['dingtalk-connector'] = { ...(entries['dingtalk-connector'] as object), enabled: true }
        const prev = (channels['dingtalk-connector'] as Record<string, unknown>) || {}
        channels['dingtalk-connector'] = {
          ...prev,
          enabled: true,
          label: REMOTE_CHANNEL_LABELS.dingtalk,
          clientId: body.clientId!,
          clientSecret: body.clientSecret!,
        }
        break
      }
      case 'weixin': {
        ensurePluginAllowed('openclaw-weixin')
        entries['openclaw-weixin'] = { ...(entries['openclaw-weixin'] as object), enabled: true }
        const prev = (channels.weixin as Record<string, unknown>) || {}
        channels.weixin = {
          ...prev,
          enabled: true,
          label: REMOTE_CHANNEL_LABELS.weixin,
        }
        break
      }
      case 'wechat_access': {
        ensurePluginAllowed('wechat-access')
        entries['wechat-access'] = { ...(entries['wechat-access'] as object), enabled: true }
        const prev = (channels['wechat-access'] as Record<string, unknown>) || {}
        channels['wechat-access'] = {
          ...prev,
          enabled: true,
          label: REMOTE_CHANNEL_LABELS.wechat_access,
          token: body.token!.trim(),
        }
        break
      }
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to merge config' }, { status: 500 })
  }

  const newRaw = JSON.stringify(parsed, null, 2) + '\n'
  try {
    await writeFile(configPath, newRaw)
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to write config: ${err?.message || err}` }, { status: 500 })
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'remote_channel_configure',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { platform: body.platform },
    ip_address: ipAddress,
  })

  await applyGatewayConfig().catch(() => {})

  return NextResponse.json({ ok: true })
}

function stripChannelCredentials(
  parsed: Record<string, unknown>,
  platform: RemoteChannelBindPlatform,
): void {
  if (!parsed.plugins || typeof parsed.plugins !== 'object') parsed.plugins = {}
  const plugins = parsed.plugins as Record<string, unknown>
  if (!plugins.entries || typeof plugins.entries !== 'object') plugins.entries = {}
  const entries = plugins.entries as Record<string, unknown>

  if (!parsed.channels || typeof parsed.channels !== 'object') parsed.channels = {}
  const channels = parsed.channels as Record<string, unknown>

  switch (platform) {
    case 'qq':
      entries['openclaw-qqbot'] = { ...(entries['openclaw-qqbot'] as object), enabled: false }
      channels.qqbot = { enabled: false }
      break
    case 'wecom':
      entries['wecom-openclaw-plugin'] = { ...(entries['wecom-openclaw-plugin'] as object), enabled: false }
      channels.wecom = { enabled: false }
      break
    case 'feishu':
      channels.feishu = { enabled: false }
      break
    case 'dingtalk':
      entries['dingtalk-connector'] = { ...(entries['dingtalk-connector'] as object), enabled: false }
      channels['dingtalk-connector'] = { enabled: false }
      break
    case 'weixin':
      entries['openclaw-weixin'] = { ...(entries['openclaw-weixin'] as object), enabled: false }
      channels.weixin = { enabled: false }
      break
    case 'wechat_access':
      entries['wechat-access'] = { ...(entries['wechat-access'] as object), enabled: false }
      channels['wechat-access'] = { enabled: false }
      break
    default:
      break
  }
}

/**
 * DELETE /api/remote-channels — 解绑远控通道：关闭插件并清除 channels 中的凭据（不含 App ID/Secret 的前端展示）
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const result = await validateBody(request, unbindSchema)
  if ('error' in result) return result.error
  const { platform } = result.data

  const configPath = config.openclawConfigPath
  if (!configPath) {
    return NextResponse.json({ error: 'OPENCLAW_CONFIG_PATH not configured' }, { status: 404 })
  }

  let raw: string
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return NextResponse.json({ error: 'Config file not found', path: configPath }, { status: 404 })
    }
    return NextResponse.json({ error: `Failed to read config: ${err?.message || err}` }, { status: 500 })
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in openclaw.json' }, { status: 500 })
  }

  try {
    stripChannelCredentials(parsed, platform)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to update config' }, { status: 500 })
  }

  const newRaw = JSON.stringify(parsed, null, 2) + '\n'
  try {
    await writeFile(configPath, newRaw)
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to write config: ${err?.message || err}` }, { status: 500 })
  }

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'remote_channel_unbind',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { platform },
    ip_address: ipAddress,
  })

  await applyGatewayConfig().catch(() => {})

  return NextResponse.json({ ok: true })
}
