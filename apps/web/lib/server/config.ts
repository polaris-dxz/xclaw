import fs from 'node:fs'
import path from 'node:path'

function resolveRepoRootFromCwd(cwd: string): string {
  const candidates = [
    cwd,
    path.resolve(cwd, '..'),
    path.resolve(cwd, '..', '..'),
    path.resolve(cwd, '..', '..', '..'),
  ]
  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'pnpm-workspace.yaml')) &&
      fs.existsSync(path.join(candidate, 'apps', 'web'))
    ) {
      return candidate
    }
  }
  return cwd
}

const repoRoot = process.env.XCLAW_REPO_ROOT || resolveRepoRootFromCwd(process.cwd())
const defaultDataDir = path.join(repoRoot, '.data')
const dataDir = process.env.XCLAW_DATA_DIR || defaultDataDir
const dbPath = process.env.XCLAW_DB_PATH || path.join(dataDir, 'xclaw.db')

export const config = {
  dataDir,
  dbPath,
}

export function ensureDirExists(dirPath: string) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}
