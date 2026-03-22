/**
 * 微信客服号 / 企业微信「快捷扫码」：二维码应编码的落地页（非配置文档 qclaw 链接）。
 */
export const REMOTE_GUIDE_QR_ENCODE_URLS = {
  wechat_access: 'https://kf.weixin.qq.com/',
  wecom: 'https://work.weixin.qq.com/',
} as const

export type RemoteGuideQrPlatform = keyof typeof REMOTE_GUIDE_QR_ENCODE_URLS

/** 仅微信客服号 / 企微快捷：由服务端决定扫码落地页，禁止用 qclaw 文档链生成二维码 */
export function resolveGuideQrEncodeUrl(guidePlatform: string): string | undefined {
  if (guidePlatform === 'wechat_access') return REMOTE_GUIDE_QR_ENCODE_URLS.wechat_access
  if (guidePlatform === 'wecom') return REMOTE_GUIDE_QR_ENCODE_URLS.wecom
  return undefined
}

/** 配置指南（qclaw 文档）— 只用于「查看配置指南」，不得作为扫码内容 */
export function isQclawDocsUrl(url: string): boolean {
  const u = url.trim()
  return /qclaw\.qq\.com/i.test(u) && /\/docs\//i.test(u)
}
