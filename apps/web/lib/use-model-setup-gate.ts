import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'

/**
 * Client-side gate: if default model is not configured, force users to /setup/models.
 * This is intentionally client-side because Next.js middleware runs in edge runtime
 * and can't safely read ~/.xclaw config; API-side guards provide the backend safety net.
 */
export function useModelSetupGate(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled !== false
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!enabled) return
    // Setup pages must remain reachable.
    if (pathname?.startsWith('/setup')) return
    if (pathname?.startsWith('/login')) return
    // Allow settings (e.g. model management + add-provider dialog) before default model is set.
    if (pathname?.startsWith('/settings')) return

    let cancelled = false
    const run = async () => {
      try {
        const res = await fetch('/api/openclaw/models', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        const primary = typeof data?.primary === 'string' ? data.primary.trim() : ''
        if (!cancelled && !primary) {
          router.replace('/setup/models')
        }
      } catch {
        // ignore: keep current UI; backend guards will still prevent session creation
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [enabled, pathname, router])
}

