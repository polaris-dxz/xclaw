const STORAGE_KEY = 'mc-chat-dismissed-conversation-ids'

/** 删除成功后写入，在合并远端列表时暂时过滤，避免 history-sync/旧 GET 把会话顶回列表 */
export function loadDismissedConversationIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.map(String) : [])
  } catch {
    return new Set()
  }
}

function saveDismissed(set: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    // ignore
  }
}

export function addDismissedConversationId(id: string) {
  const next = loadDismissedConversationIds()
  next.add(id)
  saveDismissed(next)
}

/** 服务端已不再返回该会话时，清理本地兜底 id */
export function pruneDismissedNotInRemote(remoteConversationIds: string[]) {
  const remote = new Set(remoteConversationIds)
  const s = loadDismissedConversationIds()
  let changed = false
  for (const id of [...s]) {
    if (!remote.has(id)) {
      s.delete(id)
      changed = true
    }
  }
  if (changed) saveDismissed(s)
}
