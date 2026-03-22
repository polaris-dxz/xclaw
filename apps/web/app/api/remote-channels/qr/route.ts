import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { requireRole } from '@/lib/auth'
import { isQclawDocsUrl, resolveGuideQrEncodeUrl } from '@/lib/remote-channel-guide-qr'
import { startWeixinIlinkQr } from '@/lib/weixin-ilink-qr'

/**
 * POST /api/remote-channels/qr
 * - weixin: 直连 ilink 获取登录串（不经过 gateway WS，避免 1006 断开）
 * - guide: 将落地页编成二维码（微信客服 / 企微快捷；文档链仅用于「查看配置指南」）
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  const platform = body?.platform as string | undefined
  const guideUrl = typeof body?.guideUrl === 'string' ? body.guideUrl.trim() : ''
  const qrEncodeUrlRaw = typeof body?.qrEncodeUrl === 'string' ? body.qrEncodeUrl.trim() : ''
  const guidePlatform = typeof body?.guidePlatform === 'string' ? body.guidePlatform.trim() : ''

  if (platform === 'weixin') {
    try {
      const { qrPayload, sessionKey, message } = await startWeixinIlinkQr()
      if (!qrPayload) {
        return NextResponse.json({ error: '未能获取微信登录二维码' }, { status: 502 })
      }
      let qrDataUrl: string
      if (qrPayload.startsWith('data:image')) {
        qrDataUrl = qrPayload
      } else {
        qrDataUrl = await QRCode.toDataURL(qrPayload, { margin: 2, width: 240, errorCorrectionLevel: 'M' })
      }
      return NextResponse.json({ ok: true, qrDataUrl, sessionKey, message })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
    }
  }

  if (platform === 'guide') {
    const resolved = resolveGuideQrEncodeUrl(guidePlatform)
    let encodeTarget: string
    if (resolved) {
      encodeTarget = resolved
    } else {
      const cand = qrEncodeUrlRaw || guideUrl
      if (!cand || !/^https?:\/\//i.test(cand)) {
        return NextResponse.json({ error: '需要有效的 https 链接用于生成二维码' }, { status: 400 })
      }
      if (isQclawDocsUrl(cand)) {
        return NextResponse.json(
          { error: '二维码不能使用配置文档链接；请更新页面后重试' },
          { status: 400 },
        )
      }
      encodeTarget = cand
    }
    if (isQclawDocsUrl(encodeTarget)) {
      return NextResponse.json({ error: '二维码不能使用配置文档链接' }, { status: 400 })
    }
    if (!encodeTarget || !/^https?:\/\//i.test(encodeTarget)) {
      return NextResponse.json({ error: '需要有效的 https 链接用于生成二维码' }, { status: 400 })
    }
    try {
      const qrDataUrl = await QRCode.toDataURL(encodeTarget, {
        margin: 2,
        width: 240,
        errorCorrectionLevel: 'M',
      })
      return NextResponse.json({
        ok: true,
        qrDataUrl,
        sessionKey: '',
        message: '请使用微信扫码打开页面',
      })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
    }
  }

  return NextResponse.json({ error: '未知 platform' }, { status: 400 })
}
