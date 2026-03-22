const STORAGE_KEY = 'mc-conversation-title-overrides'

export function loadConversationTitleOverrides(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

export function setConversationTitleOverride(conversationId: string, title: string | null | undefined) {
  if (typeof window === 'undefined') return
  try {
    const map = loadConversationTitleOverrides()
    const next = title?.trim()
    if (next) map[conversationId] = next
    else delete map[conversationId]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / private mode
  }
}
