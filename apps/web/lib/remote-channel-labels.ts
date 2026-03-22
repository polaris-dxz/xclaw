/**
 * 远控通道写入 openclaw.json 时的默认展示标签（与接入向导中的平台名称一致）。
 */
export const REMOTE_CHANNEL_LABELS = {
  qq: 'QQ',
  wecom: '企业微信',
  feishu: '飞书',
  dingtalk: '钉钉',
  /** 个人微信（openclaw-weixin，扫码登录） */
  weixin: '微信',
  /** 腾讯通路 / 微信客服（wechat-access 插件） */
  wechat_access: '微信客服号',
} as const

export type RemoteChannelBindPlatform = keyof typeof REMOTE_CHANNEL_LABELS
