const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 主题相关
  getSystemTheme: () => ipcRenderer.invoke('get-system-theme'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme-changed', (_, theme) => callback(theme))
  },
  
  // 应用信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Studio sidecar
  getStudioBaseUrl: () => ipcRenderer.invoke('studio:get-base-url'),
  getStudioBackendStatus: () => ipcRenderer.invoke('studio:get-backend-status'),

  // xclaw CLI（安装到 PATH，与 VS Code「Install shell command」类似）
  xclawCliGetStatus: () => ipcRenderer.invoke('xclaw-cli:get-status'),
  xclawCliInstall: () => ipcRenderer.invoke('xclaw-cli:install'),
  xclawCliUninstall: () => ipcRenderer.invoke('xclaw-cli:uninstall'),

  // 平台信息
  platform: process.platform,

  // 自动更新（electron-updater，仅打包生产环境生效）
  updaterCheck: () => ipcRenderer.invoke('updater:check'),
  updaterQuitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  onUpdaterStatus: (callback) => {
    const handler = (_, payload) => callback(payload)
    ipcRenderer.on('updater:status', handler)
    return () => ipcRenderer.removeListener('updater:status', handler)
  },
})
