const DEFAULT_STUDIO_PORT = 19101

export function normalizeStudioPort(input: string | number | undefined | null): number {
  if (typeof input === 'number' && Number.isInteger(input) && input > 0) {
    return input
  }

  if (typeof input === 'string') {
    const value = Number.parseInt(input, 10)
    if (Number.isInteger(value) && value > 0) {
      return value
    }
  }

  return DEFAULT_STUDIO_PORT
}

export function buildStudioBaseUrl(inputPort?: string | number): string {
  const port = normalizeStudioPort(inputPort)
  return `http://127.0.0.1:${port}`
}

export function buildStudioHealthUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${normalized}/health`
}

export function buildStudioEmbedUrl(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
  return `${normalized}/`
}

