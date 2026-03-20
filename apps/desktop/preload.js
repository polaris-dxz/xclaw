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
  
  // 平台信息
  platform: process.platform,
})
