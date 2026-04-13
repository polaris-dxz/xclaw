import { Buffer } from 'node:buffer'
import mammoth from 'mammoth'
import { logger } from '@/lib/logger'
import { MAX_INLINE_TEXT_CHARS, WORD_DOC_MIMES } from '@/lib/chat-messages/constants'
import { parseDataUrlBase64 } from '@/lib/chat-messages/gateway-attachments'

type ChatAttachmentInput = {
  name?: string
  type?: string
  dataUrl?: string
  size?: number
}

function isTextLikeMime(mimeType: string): boolean {
  const m = mimeType.toLowerCase().split(';')[0].trim()
  if (m.startsWith('text/')) return true
  if (m === 'application/json' || m === 'application/javascript') return true
  if (m.endsWith('+json') || m.endsWith('+xml')) return true
  return false
}

export function normalizeMessageAttachments(
  value: unknown,
): Array<{ name: string; type: string; size: number; dataUrl: string }> | undefined {
  if (!Array.isArray(value)) return undefined
  const cleaned = value
    .slice(0, 8)
    .flatMap((entry) => {
      const file = entry as ChatAttachmentInput
      if (!file || typeof file !== 'object' || typeof file.dataUrl !== 'string') return []
      if (!file.dataUrl.startsWith('data:')) return []
      const name = typeof file.name === 'string' && file.name.trim() ? file.name.trim().slice(0, 120) : 'attachment'
      const type = typeof file.type === 'string' && file.type.trim() ? file.type.trim().slice(0, 120) : 'application/octet-stream'
      const size = Number(file.size || 0)
      return [{ name, type, size: Number.isFinite(size) && size >= 0 ? size : 0, dataUrl: file.dataUrl }]
    })
  return cleaned.length > 0 ? cleaned : undefined
}

export function appendInlinedTextFromAttachments(
  base: string,
  attachments: Array<{ name: string; type: string; dataUrl: string }> | undefined,
): string {
  if (!attachments?.length) return base
  const chunks: string[] = []
  for (const att of attachments) {
    const parsed = parseDataUrlBase64(att.dataUrl)
    if (!parsed) continue
    const mime = (parsed.mimeType || att.type || '').toLowerCase()
    if (!isTextLikeMime(mime)) continue
    try {
      let text = Buffer.from(parsed.base64, 'base64').toString('utf8')
      if (text.length > MAX_INLINE_TEXT_CHARS) {
        text = `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n[... 内容已截断 ...]`
      }
      chunks.push(`\n\n---\n【附件「${att.name}」】\n${text}`)
    } catch {
      continue
    }
  }
  if (chunks.length === 0) return base
  return `${base}${chunks.join('')}`
}

export async function appendDocxTextFromAttachments(
  base: string,
  attachments: Array<{ name: string; type: string; dataUrl: string }> | undefined,
): Promise<{ message: string; excludedFileNames: Set<string> }> {
  const excludedFileNames = new Set<string>()
  if (!attachments?.length) return { message: base, excludedFileNames }

  const chunks: string[] = []
  for (const att of attachments) {
    const mime = (att.type || '').toLowerCase().split(';')[0].trim()
    if (!WORD_DOC_MIMES.has(mime)) continue
    const parsed = parseDataUrlBase64(att.dataUrl)
    if (!parsed) continue
    try {
      const buf = Buffer.from(parsed.base64, 'base64')
      const result = await mammoth.extractRawText({ buffer: buf })
      let text = (result.value || '').trim()
      if (!text) {
        logger.warn({ name: att.name }, 'Word 附件无法提取正文（空内容），仍将尝试原样转发')
        continue
      }
      if (text.length > MAX_INLINE_TEXT_CHARS) {
        text = `${text.slice(0, MAX_INLINE_TEXT_CHARS)}\n\n[... 内容已截断 ...]`
      }
      chunks.push(`\n\n---\n【Word「${att.name}」提取正文】\n${text}`)
      excludedFileNames.add(att.name)
    } catch (err) {
      logger.warn({ err, name: att.name }, 'Word 附件正文提取失败，仍将尝试原样转发')
    }
  }
  if (chunks.length === 0) return { message: base, excludedFileNames }
  return { message: `${base}${chunks.join('')}`, excludedFileNames }
}
