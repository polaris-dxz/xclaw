/** 客户端检查更新：桌面端优先 Electron autoUpdater；file:// 页须走主进程 GitHub */

import { APP_VERSION } from '@/lib/version'

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
        /** 桌面端打包为 file:// 时须走主进程请求 GitHub，见 main.js releases:check-http */
        releasesCheckHttp?: () => Promise<ReleaseCheckPayload>
        updaterCheck?: () => Promise<ElectronUpdaterCheckResult>
        updaterQuitAndInstall?: () => Promise<{ ok?: boolean }>
        onUpdaterStatus?: (cb: (payload: { type?: string }) => void) => () => void
      }
    }
  ).electronAPI
}

const UPDATER_MERGE_MS = 8000

/** 在 GitHub 版本结果上合并 electron-updater「已下载待重启」状态（限时，避免 checkForUpdates 长期挂起） */
async function mergeUpdaterReadyState(base: ReleaseCheckPayload): Promise<ReleaseCheckPayload> {
  const electron = getElectronUpdaterApi()
  if (!electron?.updaterCheck) return base
  try {
    const r = await Promise.race([
      electron.updaterCheck(),
      new Promise<'timeout'>((resolve) => {
        setTimeout(() => resolve('timeout'), UPDATER_MERGE_MS)
      }),
    ])
    if (r === 'timeout') return base
    if (!r.ok || r.dev) return base
    if (r.readyToInstall === true) {
      return {
        ...base,
        readyToInstall: true,
        updateAvailable: true,
        latestVersion: r.latestVersion ?? base.latestVersion,
        releaseUrl: r.releaseUrl && r.releaseUrl.length > 0 ? r.releaseUrl : base.releaseUrl,
        releaseNotes: r.releaseNotes ?? base.releaseNotes,
        currentVersion: r.currentVersion,
      }
    }
  } catch {
    /* 忽略：仍以 GitHub 对比结果为准 */
  }
  return base
}

async function fetchReleaseCheckViaHttp(): Promise<ReleaseCheckPayload> {
  const electron = getElectronUpdaterApi()
  if (electron?.releasesCheckHttp) {
    const data = await electron.releasesCheckHttp()
    return { ...data, readyToInstall: data.readyToInstall ?? false }
  }

  const res = await fetch('/api/releases/check', { cache: 'no-store' })
  if (!res.ok) {
    throw new Error('check failed')
  }
  const data = (await res.json()) as ReleaseCheckPayload
  return { ...data, readyToInstall: data.readyToInstall ?? false }
}

/**
 * 1) 桌面端 **优先** `releasesCheckHttp`（file:// 无 /api；且不与 electron-updater 强耦合）
 * 2) 再尝试合并 updater 的 readyToInstall
 * 3) 否则走原 updater → `/api` 回退
 * 4) 全部失败时返回本地版本降级结果，避免弹窗只能显示「无法检查更新」
 */
export async function fetchReleaseCheck(): Promise<ReleaseCheckPayload> {
  const electron = getElectronUpdaterApi()

  try {
    if (electron?.releasesCheckHttp) {
      const data = await electron.releasesCheckHttp()
      const base = { ...data, readyToInstall: data.readyToInstall ?? false }
      return mergeUpdaterReadyState(base)
    }
  } catch (e) {
    console.warn('[fetchReleaseCheck] releasesCheckHttp failed', e)
  }

  try {
    if (electron?.updaterCheck) {
      const r = await electron.updaterCheck()
      if (!r.ok) {
        return await fetchReleaseCheckViaHttp()
      }
      if (r.dev) {
        return await fetchReleaseCheckViaHttp()
      }
      return {
        updateAvailable: Boolean(r.updateAvailable && !r.readyToInstall),
        readyToInstall: r.readyToInstall === true,
        currentVersion: r.currentVersion,
        latestVersion: r.latestVersion,
        releaseUrl: r.releaseUrl,
        releaseNotes: r.releaseNotes,
      }
    }
  } catch (e) {
    console.warn('[fetchReleaseCheck] updaterCheck failed', e)
  }

  try {
    return await fetchReleaseCheckViaHttp()
  } catch (e) {
    console.warn('[fetchReleaseCheck] http fallback failed', e)
    return {
      updateAvailable: false,
      currentVersion: APP_VERSION,
      readyToInstall: false,
    }
  }
}
