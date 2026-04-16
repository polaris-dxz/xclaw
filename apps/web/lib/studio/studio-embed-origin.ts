/**
 * 浏览器将 localhost 与 127.0.0.1 视为不同 origin，但本机 Studio 常混用二者。
 * 用于 postMessage 的 targetOrigin 校验与 iframe 来源白名单。
 */
export function normalizeLoopbackHostname(hostname: string): string {
  const h = hostname.trim().toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'loopback'
  return h
}

export function studioEmbedOriginsCompatible(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    if (ua.protocol !== ub.protocol) return false
    if (ua.port !== ub.port) return false
    return normalizeLoopbackHostname(ua.hostname) === normalizeLoopbackHostname(ub.hostname)
  } catch {
    return false
  }
}
