/**
 * OpenClaw CLI / jsonl 常见：若干行元数据后，一行 `[…含日期时间…] 正文`。
 * 展示策略：**只取时间戳行里第一个 `]` 之后的文字**（不用正则剥 JSON）。
 * 若存在时间戳行但 `]` 后无正文，返回空串（便于判「仅元数据」合成块）。
 */

const SENDER_HEAD = 'sender (untrusted metadata):'

function normalizeNewlines(s: string): string {
  let o = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\r') {
      if (i + 1 < s.length && s[i + 1] === '\n') {
        o += '\n'
        i++
      } else {
        o += '\n'
      }
    } else {
      o += c
    }
  }
  return o
}

function hasDigit(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 48 && c <= 57) return true
  }
  return false
}

type ScanResult = { kind: 'body'; text: string } | { kind: 'empty' } | { kind: 'none' }

/** 扫描：有 `]` 后正文 → body；仅有时间戳行且 `]` 后为空 → empty；否则 none */
function scanBracketTimestampSuffix(block: string): ScanResult {
  const lines = normalizeNewlines(block).split('\n')
  let sawTimestampLineWithEmptyTail = false
  for (const line of lines) {
    const tr = line.trimStart()
    if (!tr.startsWith('[')) continue
    const close = tr.indexOf(']')
    if (close <= 1) continue
    const inner = tr.slice(1, close)
    if (!hasDigit(inner)) continue
    const after = tr.slice(close + 1).trimStart()
    if (after.length > 0) return { kind: 'body', text: after }
    sawTimestampLineWithEmptyTail = true
  }
  if (sawTimestampLineWithEmptyTail) return { kind: 'empty' }
  return { kind: 'none' }
}

function trimEndUserPlaceholderPhrases(s: string): string {
  let t = s.trimEnd()
  const phrases = ['user 发送的消息', 'user 发送 的消息', 'user发送的消息']
  let changed = true
  while (changed) {
    changed = false
    for (const p of phrases) {
      if (t.endsWith(p)) {
        t = t.slice(0, -p.length).trimEnd()
        changed = true
      }
    }
  }
  return t
}

function stripSenderHeadIfPresent(raw: string): string {
  const t = raw.trimStart()
  const probe = t.slice(0, Math.min(t.length, 80)).toLowerCase()
  if (!probe.startsWith(SENDER_HEAD)) return raw
  return t.slice(SENDER_HEAD.length).trimStart()
}

export function isUntrustedSenderEnvelopeContent(raw: string): boolean {
  return raw.trimStart().slice(0, 64).toLowerCase().startsWith(SENDER_HEAD)
}

export function stripUntrustedSenderMetadataEnvelope(raw: string): string {
  const full = normalizeNewlines(String(raw ?? ''))

  let scan = scanBracketTimestampSuffix(full)
  if (scan.kind === 'body') return trimEndUserPlaceholderPhrases(scan.text)
  if (scan.kind === 'empty') return ''

  const withoutSender = stripSenderHeadIfPresent(full)
  if (withoutSender !== full) {
    scan = scanBracketTimestampSuffix(withoutSender)
    if (scan.kind === 'body') return trimEndUserPlaceholderPhrases(scan.text)
    if (scan.kind === 'empty') return ''
    return trimEndUserPlaceholderPhrases(withoutSender.trim())
  }

  return trimEndUserPlaceholderPhrases(full.trim())
}
