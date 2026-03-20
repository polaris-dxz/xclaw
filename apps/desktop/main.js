const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron')
const { spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')

const isDev = process.env.NODE_ENV !== 'production'
const defaultStudioPort = 19101
let studioBackendProcess = null
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
  const child = spawn(pythonCommand, [backendEntrypoint], {
    cwd: path.dirname(backendEntrypoint),
    env: {
      ...process.env,
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
  await startStudioBackend()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopStudioBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopStudioBackend()
})

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
