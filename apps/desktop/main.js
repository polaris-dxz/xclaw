const { app, BrowserWindow, ipcMain, nativeTheme, Menu, dialog } = require('electron')
const { spawn, spawnSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

const isDev = process.env.NODE_ENV !== 'production'

const GITHUB_RELEASE_OWNER = 'polaris-dxz'
const GITHUB_RELEASE_REPO = 'xclaw'

let electronAutoUpdater = null
let pendingInstallUpdateInfo = null
const defaultStudioPort = 19101
const embeddedGatewayHost = '127.0.0.1'
const embeddedGatewayPort = 20064
let studioBackendProcess = null
let embeddedOpenClawProcess = null
let embeddedOpenClawEnv = null
let embeddedOpenClawNodeBinary = null
/** True while we intentionally stop the gateway (quit app); skip auto-respawn on exit. */
let embeddedGatewayShutdownRequested = false
let embeddedGatewayRestartTimer = null
let studioPort = normalizePort(process.env.STUDIO_BACKEND_PORT)
let studioBaseUrl = `http://127.0.0.1:${studioPort}`

function normalizePort(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }
  return defaultStudioPort
}

function resolveStudioBackendRoot() {
  if (isDev) {
    return path.resolve(__dirname, '../studio-api')
  }
  return path.join(process.resourcesPath, 'studio-api')
}

function resolveOpenClawRuntimeRoot() {
  if (isDev) {
    return path.resolve(__dirname, 'openclaw-runtime')
  }
  return path.join(process.resourcesPath, 'openclaw')
}

function resolveEmbeddedOpenClawPaths() {
  const runtimeRoot = resolveOpenClawRuntimeRoot()
  const stateDir = path.join(os.homedir(), '.xclaw')
  return {
    runtimeRoot,
    stateDir,
    configPath: path.join(stateDir, 'openclaw.json'),
    metadataPath: path.join(stateDir, 'xclaw.json'),
    workspaceDir: path.join(stateDir, 'workspace'),
    skillsDir: path.join(stateDir, 'skills'),
    runtimeSkillsDir: path.join(runtimeRoot, 'config', 'skills'),
    runtimeExtensionsDir: path.join(runtimeRoot, 'config', 'extensions'),
    openclawEntry: path.join(runtimeRoot, 'node_modules', 'openclaw', 'openclaw.mjs'),
    configTemplatePath: path.join(runtimeRoot, 'config', 'openclaw.json'),
    legacyMetadataPath: path.join(stateDir, 'xclaw-openclaw.json'),
    bundledNodeCandidates:
      process.platform === 'win32'
        ? [
            path.join(runtimeRoot, 'node_modules', 'node', 'node.exe'),
            path.join(runtimeRoot, 'node', 'node.exe'),
          ]
        : [
            path.join(runtimeRoot, 'node_modules', 'node', 'bin', 'node'),
            path.join(runtimeRoot, 'node', 'bin', 'node'),
          ],
  }
}

function ensureDirExists(dirPath) {
  if (!dirPath) return
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function normalizeStringArray(values) {
  const seen = new Set()
  const result = []
  for (const item of values) {
    const value = String(item || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function buildDefaultOpenClawConfig(paths) {
  return {
    agents: {
      defaults: {
        workspace: paths.workspaceDir,
      },
    },
    skills: {
      load: {
        extraDirs: [],
      },
    },
    gateway: {
      port: embeddedGatewayPort,
      mode: 'local',
      bind: 'loopback',
      auth: {
        mode: 'token',
        token: '',
      },
      controlUi: {
        allowedOrigins: ['null', 'file://'],
        dangerouslyDisableDeviceAuth: true,
      },
    },
    plugins: {
      enabled: true,
      load: {
        paths: [],
      },
      entries: {},
    },
  }
}

function loadOpenClawConfig(paths) {
  if (!fs.existsSync(paths.configPath)) {
    if (fs.existsSync(paths.configTemplatePath)) {
      ensureDirExists(path.dirname(paths.configPath))
      fs.copyFileSync(paths.configTemplatePath, paths.configPath)
    } else {
      const fallbackConfig = buildDefaultOpenClawConfig(paths)
      ensureDirExists(path.dirname(paths.configPath))
      fs.writeFileSync(paths.configPath, `${JSON.stringify(fallbackConfig, null, 2)}\n`)
    }
  }

  try {
    const raw = fs.readFileSync(paths.configPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch (error) {
    console.warn(`[openclaw] invalid config, rebuilding: ${error.message}`)
  }
  return buildDefaultOpenClawConfig(paths)
}

function readJsonObject(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

function readExternalOpenClawPrimaryModel() {
  const externalConfigPath = path.join(os.homedir(), '.openclaw', 'openclaw.json')
  const parsed = readJsonObject(externalConfigPath)
  if (!parsed) return ''
  const primary = String(parsed?.agents?.defaults?.model?.primary || '').trim()
  if (!primary || primary.startsWith('xclaw/')) return ''
  return primary
}

function syncExternalOpenClawAgentAuthProfiles(paths, agentId = 'main') {
  const sourcePath = path.join(os.homedir(), '.openclaw', 'agents', agentId, 'agent', 'auth-profiles.json')
  const targetPath = path.join(paths.stateDir, 'agents', agentId, 'agent', 'auth-profiles.json')
  try {
    if (!fs.existsSync(sourcePath)) return false
    ensureDirExists(path.dirname(targetPath))
    fs.copyFileSync(sourcePath, targetPath)
    return true
  } catch (error) {
    console.warn(`[openclaw] failed to sync auth profiles from ~/.openclaw: ${error.message}`)
    return false
  }
}

function ensureEmbeddedOpenClawConfig(paths) {
  ensureDirExists(paths.stateDir)
  ensureDirExists(paths.workspaceDir)
  ensureDirExists(paths.skillsDir)
  ensureDirExists(path.join(paths.workspaceDir, 'skills'))
  ensureDirExists(path.join(paths.stateDir, 'logs'))
  ensureDirExists(path.join(paths.stateDir, 'agents'))
  ensureDirExists(path.join(paths.stateDir, 'cron'))

  const config = loadOpenClawConfig(paths)
  if (!config.agents || typeof config.agents !== 'object') config.agents = {}
  if (!config.agents.defaults || typeof config.agents.defaults !== 'object') config.agents.defaults = {}
  config.agents.defaults.workspace = paths.workspaceDir
  if (!config.agents.defaults.model || typeof config.agents.defaults.model !== 'object') {
    config.agents.defaults.model = {}
  }
  const configuredPrimaryModel = String(config.agents.defaults.model.primary || '').trim()
  const externalPrimaryModel = readExternalOpenClawPrimaryModel()
  // Prefer user's existing ~/.openclaw model setting when embedded config is unset.
  if (!configuredPrimaryModel || configuredPrimaryModel.startsWith('xclaw/')) {
    if (externalPrimaryModel) {
      config.agents.defaults.model.primary = externalPrimaryModel
    } else {
      delete config.agents.defaults.model.primary
    }
  }

  if (config.models && typeof config.models === 'object') {
    const providers = config.models.providers
    if (providers && typeof providers === 'object' && providers.xclaw) {
      delete providers.xclaw
    }
    if (providers && typeof providers === 'object' && Object.keys(providers).length === 0) {
      delete config.models.providers
    }
    if (Object.keys(config.models).length === 0) {
      delete config.models
    }
  }

  // Preserve user channel config (qqbot, wecom, etc.). Do not reset channels on each launch —
  // that would wipe ~/.xclaw/openclaw.json credentials written by Mission Control / 远控通道.

  if (!config.channels || typeof config.channels !== 'object') {
    config.channels = {}
  }

  if (!config.gateway || typeof config.gateway !== 'object') config.gateway = {}
  config.gateway.port = embeddedGatewayPort
  config.gateway.mode = config.gateway.mode || 'local'
  config.gateway.bind = 'loopback'
  if (!config.gateway.auth || typeof config.gateway.auth !== 'object') config.gateway.auth = {}
  config.gateway.auth.mode = 'token'
  if (!String(config.gateway.auth.token || '').trim()) {
    config.gateway.auth.token = crypto.randomBytes(24).toString('hex')
  }
  if (!config.gateway.controlUi || typeof config.gateway.controlUi !== 'object') {
    config.gateway.controlUi = {}
  }
  config.gateway.controlUi.allowedOrigins = normalizeStringArray([
    ...(Array.isArray(config.gateway.controlUi.allowedOrigins) ? config.gateway.controlUi.allowedOrigins : []),
    'null',
    'file://',
  ])
  // Desktop embedded control UI runs on local development origins and may not always
  // provide WebCrypto device signatures in Electron; rely on gateway token auth here.
  config.gateway.controlUi.dangerouslyDisableDeviceAuth = true

  if (!config.skills || typeof config.skills !== 'object') config.skills = {}
  if (!config.skills.load || typeof config.skills.load !== 'object') config.skills.load = {}
  const existingSkillDirs = Array.isArray(config.skills.load.extraDirs) ? config.skills.load.extraDirs : []
  config.skills.load.extraDirs = normalizeStringArray([
    ...existingSkillDirs,
    ...(fs.existsSync(paths.runtimeSkillsDir) ? [paths.runtimeSkillsDir] : []),
    paths.skillsDir,
    path.join(paths.workspaceDir, 'skills'),
  ])

  if (!config.plugins || typeof config.plugins !== 'object') config.plugins = {}
  config.plugins.enabled = true
  if (!Array.isArray(config.plugins.allow)) {
    config.plugins.allow = []
  }
  if (!config.plugins.entries || typeof config.plugins.entries !== 'object') {
    config.plugins.entries = {}
  }
  if (!config.plugins.load || typeof config.plugins.load !== 'object') config.plugins.load = {}
  const existingPluginPaths = Array.isArray(config.plugins.load.paths) ? config.plugins.load.paths : []
  config.plugins.load.paths = normalizeStringArray(
    [
      ...existingPluginPaths,
      ...(fs.existsSync(paths.runtimeExtensionsDir) ? [paths.runtimeExtensionsDir] : []),
    ],
  )

  syncExternalOpenClawAgentAuthProfiles(paths, 'main')

  fs.writeFileSync(paths.configPath, `${JSON.stringify(config, null, 2)}\n`)
  return config
}

function buildEmbeddedOpenClawEnv(paths) {
  const mdnsHostname =
    process.env.OPENCLAW_MDNS_HOSTNAME ||
    process.env.XCLAW_OPENCLAW_MDNS_HOSTNAME ||
    `xclaw-${embeddedGatewayPort}`
  return {
    OPENCLAW_STATE_DIR: paths.stateDir,
    OPENCLAW_CONFIG_PATH: paths.configPath,
    OPENCLAW_GATEWAY_HOST: embeddedGatewayHost,
    OPENCLAW_GATEWAY_PORT: String(embeddedGatewayPort),
    OPENCLAW_BIN: paths.openclawEntry,
    OPENCLAW_MDNS_HOSTNAME: mdnsHostname,
  }
}

function writeEmbeddedOpenClawMetadata(paths, pid = null) {
  try {
    if (fs.existsSync(paths.legacyMetadataPath)) {
      fs.rmSync(paths.legacyMetadataPath, { force: true })
    }
    const metadata = {
      cli: {
        nodeBinary: embeddedOpenClawNodeBinary || process.execPath,
        openclawEntry: paths.openclawEntry,
        openclawMjs: paths.openclawEntry,
        pid,
      },
      stateDir: paths.stateDir,
      configPath: paths.configPath,
      port: embeddedGatewayPort,
      platform: process.platform,
      updatedAt: new Date().toISOString(),
    }
    fs.writeFileSync(paths.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  } catch (error) {
    console.warn(`[openclaw] failed writing metadata: ${error.message}`)
  }
}

function parseSemver(rawVersion) {
  const match = String(rawVersion || '').trim().match(/v?(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  }
}

function isSemverAtLeast(version, minimum) {
  if (!version) return false
  if (version.major !== minimum.major) return version.major > minimum.major
  if (version.minor !== minimum.minor) return version.minor > minimum.minor
  return version.patch >= minimum.patch
}

function probeNodeVersion(command) {
  if (!command) return null
  if (command === process.execPath) {
    return parseSemver(process.versions.node)
  }
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    shell: false,
  })
  if (result.error || result.status !== 0) return null
  const raw = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
  return parseSemver(raw)
}

function resolveOpenClawNodeBinary(paths) {
  const minimum = { major: 22, minor: 16, patch: 0 }
  const bundledNode = (paths.bundledNodeCandidates || []).find((candidate) => fs.existsSync(candidate)) || ''
  const candidates = normalizeStringArray([
    process.env.OPENCLAW_NODE_BIN,
    process.env.XCLAW_OPENCLAW_NODE_BIN,
    bundledNode,
    'node',
    process.execPath,
  ])

  for (const candidate of candidates) {
    const version = probeNodeVersion(candidate)
    if (!isSemverAtLeast(version, minimum)) {
      continue
    }
    return { binary: candidate, version }
  }

  return null
}

function resolvePythonCommand() {
  if (process.env.STUDIO_PYTHON_BIN) {
    return process.env.STUDIO_PYTHON_BIN
  }
  if (process.env.PYTHON_BIN) {
    return process.env.PYTHON_BIN
  }

  const backendRoot = resolveStudioBackendRoot()
  const localVenvPython = path.resolve(__dirname, '../../.venv/bin/python')
  if (fs.existsSync(localVenvPython)) {
    return localVenvPython
  }

  return 'python3'
}

function isPortListening(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      resolve(false)
    })
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function findAvailablePort(startPort, maxAttempts = 20) {
  for (let candidate = startPort; candidate < startPort + maxAttempts; candidate += 1) {
    const occupied = await isPortListening(candidate)
    if (!occupied) {
      return candidate
    }
  }
  return startPort
}

async function waitForPortListening(port, host = '127.0.0.1', attempts = 40, intervalMs = 250) {
  for (let index = 0; index < attempts; index += 1) {
    const listening = await isPortListening(port, host)
    if (listening) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

async function startEmbeddedOpenClaw() {
  if (embeddedOpenClawProcess) return

  const paths = resolveEmbeddedOpenClawPaths()
  ensureEmbeddedOpenClawConfig(paths)
  embeddedOpenClawEnv = buildEmbeddedOpenClawEnv(paths)

  const listening = await isPortListening(embeddedGatewayPort, embeddedGatewayHost)
  if (listening) {
    writeEmbeddedOpenClawMetadata(paths, null)
    console.log(`[openclaw] gateway already running on ${embeddedGatewayHost}:${embeddedGatewayPort}`)
    return
  }

  if (!fs.existsSync(paths.openclawEntry)) {
    console.warn(`[openclaw] entry not found: ${paths.openclawEntry}`)
    return
  }

  const resolvedNode = resolveOpenClawNodeBinary(paths)
  if (!resolvedNode) {
    console.error(
      '[openclaw] no compatible Node.js runtime found for embedded gateway. ' +
      'Required >= v22.16.0. Set OPENCLAW_NODE_BIN to a Node 22.16+ binary.',
    )
    writeEmbeddedOpenClawMetadata(paths, null)
    return
  }
  embeddedOpenClawNodeBinary = resolvedNode.binary

  const child = spawn(resolvedNode.binary, [paths.openclawEntry, 'gateway', 'run'], {
    cwd: paths.runtimeRoot,
    env: {
      ...process.env,
      ...embeddedOpenClawEnv,
      ...(resolvedNode.binary === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[openclaw] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[openclaw] ${chunk}`)
  })
  child.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`
    console.log(`[openclaw] embedded gateway exited (${reason})`)
    embeddedOpenClawProcess = null
    writeEmbeddedOpenClawMetadata(paths, null)
    if (embeddedGatewayShutdownRequested) {
      embeddedGatewayShutdownRequested = false
      return
    }
    // OpenClaw may full-restart the gateway process (e.g. after config reload / 解绑).
    // Electron's child exits but we must respawn or 20064 stays down until app restart.
    if (embeddedGatewayRestartTimer) {
      clearTimeout(embeddedGatewayRestartTimer)
    }
    embeddedGatewayRestartTimer = setTimeout(() => {
      embeddedGatewayRestartTimer = null
      console.log('[openclaw] respawning embedded gateway after process exit...')
      startEmbeddedOpenClaw().catch((err) => {
        console.error(`[openclaw] failed to respawn embedded gateway: ${err.message}`)
      })
    }, 1500)
  })
  child.on('error', (error) => {
    console.error(`[openclaw] failed to start embedded gateway: ${error.message}`)
    embeddedOpenClawProcess = null
    writeEmbeddedOpenClawMetadata(paths, null)
  })

  embeddedOpenClawProcess = child
  writeEmbeddedOpenClawMetadata(paths, child.pid || null)

  const ready = await waitForPortListening(embeddedGatewayPort, embeddedGatewayHost)
  if (!ready) {
    console.warn('[openclaw] embedded gateway did not become ready in time')
  } else {
    console.log(`[openclaw] embedded gateway running on ${embeddedGatewayHost}:${embeddedGatewayPort}`)
  }
}

async function startStudioBackend() {
  if (studioBackendProcess) {
    return
  }

  const preferredPort = studioPort
  const preferredOccupied = await isPortListening(preferredPort)
  if (preferredOccupied) {
    const fallbackPort = await findAvailablePort(preferredPort + 1)
    studioPort = fallbackPort
    studioBaseUrl = `http://127.0.0.1:${studioPort}`
    console.log(`[studio] port ${preferredPort} is occupied, using ${studioPort}`)
  }

  const backendRoot = resolveStudioBackendRoot()
  const backendEntrypoint = path.join(backendRoot, 'apps', 'api', 'app.py')

  if (!fs.existsSync(backendEntrypoint)) {
    console.warn(`[studio] backend entry not found: ${backendEntrypoint}`)
    return
  }

  const pythonCommand = resolvePythonCommand()
  const fallbackPaths = resolveEmbeddedOpenClawPaths()
  const runtimeOpenClawEnv = embeddedOpenClawEnv || buildEmbeddedOpenClawEnv(fallbackPaths)
  const child = spawn(pythonCommand, [backendEntrypoint], {
    cwd: path.dirname(backendEntrypoint),
    env: {
      ...process.env,
      ...runtimeOpenClawEnv,
      STAR_BACKEND_PORT: String(studioPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[studio-api] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[studio-api] ${chunk}`)
  })
  child.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`
    console.log(`[studio] backend exited (${reason})`)
    studioBackendProcess = null
  })
  child.on('error', (error) => {
    console.error(`[studio] backend failed to start: ${error.message}`)
    studioBackendProcess = null
  })

  studioBackendProcess = child
  console.log(`[studio] backend started on ${studioBaseUrl}`)
}

function stopStudioBackend() {
  if (!studioBackendProcess || studioBackendProcess.killed) {
    return
  }
  studioBackendProcess.kill('SIGTERM')
}

function stopEmbeddedOpenClaw() {
  if (embeddedGatewayRestartTimer) {
    clearTimeout(embeddedGatewayRestartTimer)
    embeddedGatewayRestartTimer = null
  }
  if (!embeddedOpenClawProcess || embeddedOpenClawProcess.killed) {
    return
  }
  embeddedGatewayShutdownRequested = true
  embeddedOpenClawProcess.kill('SIGTERM')
}

function releaseTagUrl(version) {
  const v = String(version || '').replace(/^v/, '')
  if (!v) return ''
  return `https://github.com/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPO}/releases/tag/v${v}`
}

/** 与 apps/web/app/api/releases/check/route.ts 一致，供 file:// 打包页无法请求 Next /api 时使用 */
const GITHUB_RELEASES_API_URL =
  process.env.XCLAW_RELEASES_URL ||
  `https://api.github.com/repos/${GITHUB_RELEASE_OWNER}/${GITHUB_RELEASE_REPO}/releases/latest`

function compareSemverForRelease(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number)
  const pb = String(b).replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

function broadcastUpdaterStatus(payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send('updater:status', payload)
    }
  }
}

function initElectronUpdater() {
  if (isDev) {
    return
  }
  try {
    electronAutoUpdater = require('electron-updater').autoUpdater
  } catch (e) {
    console.warn('[updater] failed to load electron-updater:', e.message)
    return
  }

  const autoUpdater = electronAutoUpdater
  autoUpdater.autoDownload = true
  autoUpdater.allowPrerelease = false

  autoUpdater.on('update-available', (info) => {
    pendingInstallUpdateInfo = null
    broadcastUpdaterStatus({
      type: 'update-available',
      version: info?.version,
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : '',
    })
  })

  autoUpdater.on('update-not-available', () => {
    broadcastUpdaterStatus({ type: 'update-not-available' })
  })

  autoUpdater.on('download-progress', (progress) => {
    broadcastUpdaterStatus({ type: 'download-progress', progress })
  })

  autoUpdater.on('update-downloaded', (info) => {
    pendingInstallUpdateInfo = info
    broadcastUpdaterStatus({ type: 'update-downloaded', version: info?.version })
  })

  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err.message)
    broadcastUpdaterStatus({ type: 'error', message: err.message })
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => console.warn('[updater] initial check:', e.message))
  }, 8000)

  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 6 * 60 * 60 * 1000)
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0D0D0D' : '#FFFFFF',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  const startUrl = isDev 
    ? 'http://localhost:20263' 
    : `file://${path.join(process.resourcesPath, 'web/out/index.html')}`

  mainWindow.loadURL(startUrl)

  // 开发模式下打开开发者工具
  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  // 监听主题变化
  nativeTheme.on('updated', () => {
    mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })
}

app.whenReady().then(async () => {
  await startEmbeddedOpenClaw()
  await startStudioBackend()
  installMacApplicationMenu()
  createWindow()
  initElectronUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopEmbeddedOpenClaw()
  stopStudioBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopEmbeddedOpenClaw()
  stopStudioBackend()
})

// ------------------------------------------------------------------
// xclaw CLI：安装到 PATH（参考 VS Code「Install shell command」）
// macOS/Linux：~/bin/xclaw -> 应用内 scripts/xclaw
// Windows：%LOCALAPPDATA%\\xclaw\\bin\\xclaw.cmd，并追加用户 PATH
// ------------------------------------------------------------------

function resolveXclawCliScriptPaths(paths) {
  const dir = path.join(paths.runtimeSkillsDir, 'xclaw-openclaw', 'scripts')
  return {
    scriptDir: dir,
    xclaw: path.join(dir, 'xclaw'),
    xclawMacSh: path.join(dir, 'xclaw-mac.sh'),
    xclawCmd: path.join(dir, 'xclaw.cmd'),
  }
}

function normalizePathForCompare(p) {
  try {
    return path.resolve(p).toLowerCase()
  } catch {
    return ''
  }
}

function isDirOnPathEnv(dir) {
  const envPath = process.env.PATH || ''
  const want = normalizePathForCompare(dir)
  return envPath.split(path.delimiter).some((seg) => seg && normalizePathForCompare(seg) === want)
}

function addDirToUserPathWin32(dir) {
  const escaped = dir.replace(/'/g, "''")
  const ps = `$d = '${escaped}'; $u = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not $u) { $u = '' }; if ($u -notlike "*$d*") { [Environment]::SetEnvironmentVariable('Path', ($u.TrimEnd(';') + ';' + $d), 'User') }`
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    encoding: 'utf8',
  })
  return r.status === 0
}

function removeDirFromUserPathWin32(dir) {
  const escaped = dir.replace(/'/g, "''")
  const ps = `$d = '${escaped}'; $u = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not $u) { return }; $parts = $u -split ';' | Where-Object { $_ -and $_ -ne $d }; [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')`
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8' })
}

function getXclawCliStatus() {
  const paths = resolveEmbeddedOpenClawPaths()
  const sp = resolveXclawCliScriptPaths(paths)
  if (!fs.existsSync(sp.xclaw) || !fs.existsSync(sp.xclawMacSh)) {
    return { ok: false, error: 'bundle_missing', scripts: sp }
  }
  if (process.platform === 'win32') {
    const binDir = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'xclaw',
      'bin',
    )
    const target = path.join(binDir, 'xclaw.cmd')
    const installed = fs.existsSync(target)
    return {
      ok: true,
      platform: 'win32',
      installed,
      sourcePath: sp.xclawCmd,
      targetPath: target,
      binDir,
      binDirOnPath: isDirOnPathEnv(binDir),
    }
  }
  const homeBin = path.join(os.homedir(), 'bin')
  const dest = path.join(homeBin, 'xclaw')
  let installed = false
  if (fs.existsSync(dest)) {
    try {
      const st = fs.lstatSync(dest)
      if (st.isSymbolicLink()) {
        const rel = fs.readlinkSync(dest)
        const resolved = path.resolve(path.dirname(dest), rel)
        installed = normalizePathForCompare(resolved) === normalizePathForCompare(sp.xclaw)
      }
    } catch {
      /* ignore */
    }
  }
  return {
    ok: true,
    platform: process.platform,
    installed,
    sourcePath: sp.xclaw,
    targetPath: dest,
    homeBin,
    homeBinOnPath: isDirOnPathEnv(homeBin),
  }
}

function installXclawShellCommand() {
  const paths = resolveEmbeddedOpenClawPaths()
  const sp = resolveXclawCliScriptPaths(paths)
  if (!fs.existsSync(sp.xclaw) || !fs.existsSync(sp.xclawMacSh)) {
    return { ok: false, error: 'bundle_missing' }
  }
  try {
    fs.chmodSync(sp.xclaw, 0o755)
    fs.chmodSync(sp.xclawMacSh, 0o755)
  } catch {
    /* ignore */
  }

  if (process.platform === 'win32') {
    if (!fs.existsSync(sp.xclawCmd)) {
      return { ok: false, error: 'bundle_missing' }
    }
    const binDir = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'xclaw',
      'bin',
    )
    ensureDirExists(binDir)
    const dest = path.join(binDir, 'xclaw.cmd')
    fs.copyFileSync(sp.xclawCmd, dest)
    addDirToUserPathWin32(binDir)
    return { ok: true, targetPath: dest, binDirOnPath: true }
  }

  const binDir = path.join(os.homedir(), 'bin')
  ensureDirExists(binDir)
  const dest = path.join(binDir, 'xclaw')
  const sourceAbs = path.resolve(sp.xclaw)
  if (fs.existsSync(dest)) {
    try {
      const st = fs.lstatSync(dest)
      if (st.isSymbolicLink()) {
        const rel = fs.readlinkSync(dest)
        const resolved = path.resolve(path.dirname(dest), rel)
        if (normalizePathForCompare(resolved) === normalizePathForCompare(sp.xclaw)) {
          return { ok: true, targetPath: dest, alreadyInstalled: true, homeBinOnPath: isDirOnPathEnv(binDir) }
        }
      }
    } catch {
      /* fall through to replace */
    }
    fs.unlinkSync(dest)
  }
  fs.symlinkSync(sourceAbs, dest)
  return {
    ok: true,
    targetPath: dest,
    homeBinOnPath: isDirOnPathEnv(binDir),
  }
}

function uninstallXclawShellCommand() {
  const paths = resolveEmbeddedOpenClawPaths()
  const sp = resolveXclawCliScriptPaths(paths)
  if (process.platform === 'win32') {
    const binDir = path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'xclaw',
      'bin',
    )
    const dest = path.join(binDir, 'xclaw.cmd')
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest)
    }
    removeDirFromUserPathWin32(binDir)
    return { ok: true, targetPath: dest }
  }
  const dest = path.join(os.homedir(), 'bin', 'xclaw')
  if (!fs.existsSync(dest)) {
    return { ok: true, targetPath: dest, alreadyRemoved: true }
  }
  try {
    const st = fs.lstatSync(dest)
    if (st.isSymbolicLink()) {
      const rel = fs.readlinkSync(dest)
      const resolved = path.resolve(path.dirname(dest), rel)
      if (normalizePathForCompare(resolved) === normalizePathForCompare(sp.xclaw)) {
        fs.unlinkSync(dest)
        return { ok: true, targetPath: dest }
      }
    }
    return { ok: false, error: 'not_our_symlink' }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

async function showXclawCliDialog(title, message, type = 'info') {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null
  await dialog.showMessageBox(win || undefined, {
    type: type === 'error' ? 'error' : 'info',
    title,
    message,
    buttons: ['确定'],
    defaultId: 0,
  })
}

function buildShellCommandMenuClickHandlers() {
  return {
    install: async () => {
      const result = installXclawShellCommand()
      if (!result.ok) {
        if (result.error === 'bundle_missing') {
          await showXclawCliDialog('xclaw CLI', '未找到内置命令脚本，请重新安装 xclaw。', 'error')
        } else {
          await showXclawCliDialog('xclaw CLI', `安装失败：${result.error || 'unknown'}`, 'error')
        }
        return
      }
      if (result.alreadyInstalled) {
        await showXclawCliDialog('xclaw CLI', `xclaw 命令已就绪：\n${result.targetPath}`)
        return
      }
      if (process.platform === 'win32') {
        await showXclawCliDialog(
          'xclaw CLI',
          `已安装到：\n${result.targetPath}\n\n已尝试将目录加入用户 PATH。请重新打开终端后运行：xclaw`,
        )
        return
      }
      const hint = result.homeBinOnPath
        ? '可在终端中运行：xclaw'
        : `已将命令安装到：\n${result.targetPath}\n\n若终端提示找不到命令，请将下面目录加入 PATH（例如写入 ~/.zprofile）：\n${path.join(os.homedir(), 'bin')}`
      await showXclawCliDialog('xclaw CLI', hint)
    },
    uninstall: async () => {
      const result = uninstallXclawShellCommand()
      if (!result.ok) {
        await showXclawCliDialog('xclaw CLI', result.error === 'not_our_symlink' ? '目标不是由 xclaw 创建的链接，已跳过删除。' : `卸载失败：${result.error}`, 'error')
        return
      }
      await showXclawCliDialog('xclaw CLI', '已从 PATH 安装位置移除 xclaw 命令。')
    },
  }
}

function installMacApplicationMenu() {
  if (process.platform !== 'darwin') return
  const handlers = buildShellCommandMenuClickHandlers()
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Install \'xclaw\' command in PATH',
          click: () => {
            void handlers.install()
          },
        },
        {
          label: 'Uninstall \'xclaw\' command from PATH',
          click: () => {
            void handlers.uninstall()
          },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'xclaw CLI 帮助',
          click: () => {
            void showXclawCliDialog(
              'xclaw CLI',
              '在「设置 → 概览」或使用本菜单安装后，终端运行 xclaw（与系统 openclaw 区分）。需先启动过本应用以生成 ~/.xclaw/xclaw.json。',
            )
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// IPC 处理
ipcMain.handle('get-system-theme', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
})

ipcMain.handle('set-theme', (_, theme) => {
  nativeTheme.themeSource = theme
  return true
})

ipcMain.handle('get-app-version', () => {
  return app.getVersion()
})

/**
 * 打包后页面为 file:// 静态资源，相对路径 /api/releases/check 无效；
 * 由主进程请求 GitHub（与 Next route 行为对齐）。
 */
ipcMain.handle('releases:check-http', async () => {
  const currentVersion = app.getVersion()
  try {
    const res = await fetch(GITHUB_RELEASES_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        // GitHub API 要求有效 User-Agent，否则可能 403
        'User-Agent': `xclaw-desktop/${currentVersion} (Electron)`,
      },
    })
    if (!res.ok) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: undefined,
        releaseUrl: '',
        releaseNotes: '',
        readyToInstall: false,
      }
    }
    const release = await res.json()
    const latestVersion = String(release.tag_name ?? '').replace(/^v/, '')
    const updateAvailable = compareSemverForRelease(latestVersion, currentVersion) > 0
    return {
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseUrl: release.html_url ?? '',
      releaseNotes: typeof release.body === 'string' ? release.body : '',
      readyToInstall: false,
    }
  } catch (e) {
    console.warn('[releases:check-http]', e.message)
    return {
      updateAvailable: false,
      currentVersion,
      readyToInstall: false,
    }
  }
})

ipcMain.handle('studio:get-base-url', () => {
  return studioBaseUrl
})

ipcMain.handle('studio:get-backend-status', () => {
  return {
    running: Boolean(studioBackendProcess && !studioBackendProcess.killed),
    port: studioPort,
    baseUrl: studioBaseUrl,
  }
})

ipcMain.handle('xclaw-cli:get-status', () => getXclawCliStatus())

ipcMain.handle('xclaw-cli:install', () => installXclawShellCommand())

ipcMain.handle('xclaw-cli:uninstall', () => uninstallXclawShellCommand())

ipcMain.handle('updater:check', async () => {
  const currentVersion = app.getVersion()
  if (isDev) {
    return { ok: true, dev: true, updateAvailable: false, currentVersion }
  }
  if (pendingInstallUpdateInfo) {
    const latestVersion = String(pendingInstallUpdateInfo.version || '').replace(/^v/, '')
    return {
      ok: true,
      updateAvailable: true,
      readyToInstall: true,
      currentVersion,
      latestVersion,
      releaseUrl: releaseTagUrl(latestVersion),
      releaseNotes:
        typeof pendingInstallUpdateInfo.releaseNotes === 'string'
          ? pendingInstallUpdateInfo.releaseNotes
          : '',
    }
  }
  if (!electronAutoUpdater) {
    return { ok: false, error: 'updater_unavailable', currentVersion }
  }
  try {
    const result = await electronAutoUpdater.checkForUpdates()
    if (!result) {
      return { ok: true, updateAvailable: false, currentVersion }
    }
    const latestVersion = String(result.updateInfo?.version || '').replace(/^v/, '')
    const updateAvailable = result.isUpdateAvailable === true
    const relNotes = result.updateInfo?.releaseNotes
    return {
      ok: true,
      updateAvailable,
      currentVersion,
      latestVersion,
      releaseUrl: latestVersion ? releaseTagUrl(latestVersion) : '',
      releaseNotes: typeof relNotes === 'string' ? relNotes : '',
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e), currentVersion }
  }
})

ipcMain.handle('updater:quit-and-install', () => {
  if (isDev || !electronAutoUpdater) {
    return { ok: false, reason: 'not_available' }
  }
  if (!pendingInstallUpdateInfo) {
    return { ok: false, reason: 'nothing_downloaded' }
  }
  electronAutoUpdater.quitAndInstall(false, true)
  return { ok: true }
})
