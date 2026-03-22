/**
 * Strip ANSI escape sequences from CLI stdout (OpenClaw may colorize even with --json).
 */
export function stripAnsiCodes(input: string): string {
  return input.replace(/\u001b\[[\s\S]*?m/g, '').replace(/\u001b\]8;;[^\u0007]*\u0007/g, '')
}

/**
 * Extract first top-level `{ ... }` block with balanced braces (handles nested JSON).
 */
export function extractFirstJsonObject(text: string): string | null {
  const s = text.trim()
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (c === '\\') {
        escape = true
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/** Parse JSON from mixed CLI output; tolerates leading log lines / ANSI / nested objects. */
export function parseJsonFromCliStdout(stdout: string, stderr = ''): unknown {
  const stripped = stripAnsiCodes(`${stdout}\n${stderr}`).trim()
  if (!stripped) {
    throw new Error('CLI produced empty output')
  }
  try {
    return JSON.parse(stripped)
  } catch {
    const block = extractFirstJsonObject(stripped)
    if (block) {
      return JSON.parse(block)
    }
    throw new Error('No valid JSON object in CLI output')
  }
}
