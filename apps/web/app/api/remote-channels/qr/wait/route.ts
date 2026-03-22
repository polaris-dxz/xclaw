import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { config } from '@/lib/config'
import { getDetectedGatewayToken } from '@/lib/gateway-runtime'
import { waitWeixinIlinkQr } from '@/lib/weixin-ilink-qr'

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
  const timeout = setTimeout(() => controller.abort(), 10_000)
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
 * POST /api/remote-channels/qr/wait — 直连 ilink 长轮询直到扫码完成（与 /qr 同一进程内的 session）
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  const sessionKey = typeof body?.sessionKey === 'string' ? body.sessionKey.trim() : ''
  if (!sessionKey) {
    return NextResponse.json({ error: 'sessionKey required' }, { status: 400 })
  }

  try {
    const result = await waitWeixinIlinkQr(sessionKey, 480_000)
    if (!result.connected) {
      return NextResponse.json({
        ok: false,
        connected: false,
        message: result.message || '登录未完成或已超时',
      })
    }
    await applyGatewayConfig().catch(() => {})
    return NextResponse.json({ ok: true, connected: true, message: result.message })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
