/** 客户端检查更新：桌面端优先 Electron updater，否则走 /api/releases/check */

export const DISMISSED_RELEASE_KEY = 'xclaw.dismissedReleaseVersion'

export type ReleaseCheckPayload = {
  updateAvailable: boolean
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  releaseNotes?: string
  /** 桌面端：安装包已下载，可重启完成更新 */
  readyToInstall?: boolean
}

type ElectronUpdaterCheckResult = {
  ok: boolean
  dev?: boolean
  error?: string
  updateAvailable?: boolean
  readyToInstall?: boolean
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  releaseNotes?: string
}

export function getElectronUpdaterApi() {
  if (typeof window === 'undefined') return undefined
  return (
    window as Window & {
      electronAPI?: {
        updaterCheck?: () => Promise<ElectronUpdaterCheckResult>
        updaterQuitAndInstall?: () => Promise<{ ok?: boolean }>
        onUpdaterStatus?: (cb: (payload: { type?: string }) => void) => () => void
      }
    }
  ).electronAPI
}

export async function fetchReleaseCheck(): Promise<ReleaseCheckPayload> {
  const electron = getElectronUpdaterApi()
  if (electron?.updaterCheck) {
    const r = await electron.updaterCheck()
    if (!r.ok) {
      throw new Error(r.error || 'check failed')
    }
    if (r.dev) {
      // 开发模式：走 Next /api，与纯 Web 一致
    } else {
      return {
        updateAvailable: Boolean(r.updateAvailable && !r.readyToInstall),
        readyToInstall: r.readyToInstall === true,
        currentVersion: r.currentVersion,
        latestVersion: r.latestVersion,
        releaseUrl: r.releaseUrl,
        releaseNotes: r.releaseNotes,
      }
    }
  }

  const res = await fetch('/api/releases/check', { cache: 'no-store' })
  if (!res.ok) {
    throw new Error('check failed')
  }
  const data = (await res.json()) as ReleaseCheckPayload
  return { ...data, readyToInstall: data.readyToInstall ?? false }
}
