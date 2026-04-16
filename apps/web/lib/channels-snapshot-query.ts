/** Channel snapshot from GET /api/channels — shared with React Query + UI. */
export type ChannelSnapshot = {
  channels?: Record<string, { configured?: boolean }>
}

export const CHANNELS_SNAPSHOT_QUERY_KEY = ['channels', 'snapshot'] as const

export async function fetchChannelsSnapshot(): Promise<ChannelSnapshot> {
  const res = await fetch('/api/channels', { cache: 'no-store', credentials: 'include' })
  const data = (await res.json().catch(() => ({}))) as unknown
  if (!res.ok) {
    const msg =
      typeof (data as { error?: string })?.error === 'string'
        ? (data as { error: string }).error
        : '加载通道状态失败'
    throw new Error(msg)
  }
  return data as ChannelSnapshot
}
