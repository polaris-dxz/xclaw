export type GatewayAttachmentPart =
  | { type: 'image'; mimeType: string; fileName?: string; content: string }
  | { type: 'file'; mimeType: string; fileName?: string; content: string }

type ChatAttachmentInput = {
  name?: string
  type?: string
  dataUrl?: string
  size?: number
}

export function parseDataUrlBase64(dataUrl: string): { mimeType: string; base64: string } | null {
  if (!dataUrl.startsWith('data:')) return null
  const marker = ';base64,'
  const idx = dataUrl.indexOf(marker)
  if (idx < 0) return null
  const header = dataUrl.slice('data:'.length, idx)
  const base64 = dataUrl.slice(idx + marker.length)
  if (!header || !base64) return null
  const mimeType = header.split(';')[0].trim() || 'application/octet-stream'
  return { mimeType, base64 }
}

function isTextLikeMime(mimeType: string): boolean {
  const m = mimeType.toLowerCase().split(';')[0].trim()
  if (m.startsWith('text/')) return true
  if (m === 'application/json' || m === 'application/javascript') return true
  if (m.endsWith('+json') || m.endsWith('+xml')) return true
  return false
}

export function toGatewayAttachments(
  value: unknown,
  opts?: { excludeTextLike?: boolean; excludeFileNames?: Set<string> },
): GatewayAttachmentPart[] | undefined {
  if (!Array.isArray(value)) return undefined

  const out: GatewayAttachmentPart[] = []
  for (const entry of value) {
    const file = entry as ChatAttachmentInput
    if (!file || typeof file !== 'object' || typeof file.dataUrl !== 'string') continue
    const fileName = typeof file.name === 'string' ? file.name : ''
    if (fileName && opts?.excludeFileNames?.has(fileName)) continue
    const parsed = parseDataUrlBase64(file.dataUrl)
    if (!parsed) continue
    const { mimeType, base64: content } = parsed
    if (opts?.excludeTextLike && isTextLikeMime(mimeType)) continue
    const base = {
      mimeType,
      fileName: typeof file.name === 'string' ? file.name : undefined,
      content,
    }
    if (mimeType.startsWith('image/')) {
      out.push({ type: 'image', ...base })
    } else {
      out.push({ type: 'file', ...base })
    }
  }

  return out.length > 0 ? out : undefined
}
