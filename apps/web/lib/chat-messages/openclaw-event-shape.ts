import type { MessageContentPart, TranscriptMessage } from '@/lib/transcript-parser'

/**
 * OpenClaw 会话 jsonl 单行形状（与 `parseJsonlTranscript` 所识别的 `type: "message"` 一致）。
 * 见 `~/.xclaw/agents/<agent>/sessions/<id>.jsonl`。
 */
export function openclawMessageLine(
  role: 'user' | 'assistant' | 'system',
  content: string | unknown[],
  timestamp?: string,
): Record<string, unknown> {
  const line: Record<string, unknown> = {
    type: 'message',
    message: { role, content },
  }
  if (timestamp) line.timestamp = timestamp
  return line
}

export function stringifyOpenclawEventLine(ev: Record<string, unknown>): string {
  return JSON.stringify(ev)
}

function parseToolInputString(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** 无原始 jsonl 行时，按当前行对应的 transcript 片段合成一行等价结构 */
export function syntheticOpenclawLineFromPart(entry: TranscriptMessage, part: MessageContentPart): Record<string, unknown> {
  const ts = entry.timestamp
  const role = entry.role

  if (part.type === 'text') {
    return openclawMessageLine(role, part.text, ts)
  }
  if (part.type === 'thinking') {
    return openclawMessageLine(role, [{ type: 'thinking', thinking: part.thinking }], ts)
  }
  if (part.type === 'tool_use') {
    const input = parseToolInputString(part.input)
    return openclawMessageLine(role, [{ type: 'tool_use', id: part.id, name: part.name, input }], ts)
  }
  if (part.type === 'tool_result') {
    return openclawMessageLine(
      role,
      [
        {
          type: 'tool_result',
          tool_use_id: part.toolUseId,
          content: part.content,
          is_error: part.isError === true,
        },
      ] as unknown[],
      ts,
    )
  }
  return openclawMessageLine(role, '', ts)
}

/** 写入 SQLite：有磁盘原始行则原样存（与 jsonl 字节对齐），否则存合成行 */
export function openclawEventJsonStringForTranscriptRow(entry: TranscriptMessage, part: MessageContentPart): string {
  if (entry.rawJsonlLine) return entry.rawJsonlLine
  return stringifyOpenclawEventLine(syntheticOpenclawLineFromPart(entry, part))
}

export function parseOpenclawEventJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
