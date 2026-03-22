import type { Conversation } from '@/store'

/** 用户点击「新建」等：侧栏可与远端会话并存 */
export const PENDING_CONVERSATION_PREFIX = 'pending:' as const

/**
 * 列表为空 / 删光后自动补一条：远端已有会话时不应再显示，否则会与 GET /api/chat/conversations 条数不一致。
 */
export const PENDING_AUTO_PREFIX = 'pending:auto:' as const

export function isPendingConversation(id: string | null | undefined): boolean {
  // pending:auto: 与 pending:<ts> 均以 pending: 开头
  return Boolean(id && id.startsWith('pending:'))
}

export function isAutoPendingConversation(id: string | null | undefined): boolean {
  return Boolean(id && id.startsWith(PENDING_AUTO_PREFIX))
}

/** 用户主动新建（可与已有会话并列） */
export function createPendingConversation(): Conversation {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: `${PENDING_CONVERSATION_PREFIX}${Date.now()}`,
    name: '新对话',
    participants: [],
    unreadCount: 0,
    updatedAt: now,
  }
}

/** 无会话时的默认占位（远端拉取到会话后应被合并逻辑丢弃） */
export function createAutoPendingConversation(): Conversation {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: `${PENDING_AUTO_PREFIX}${Date.now()}`,
    name: '新对话',
    participants: [],
    unreadCount: 0,
    updatedAt: now,
  }
}
