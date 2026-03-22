const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('subtitleOverlay', {
  close: () => ipcRenderer.send('subtitle-overlay:close'),
  expand: (expanded) => ipcRenderer.send('subtitle-overlay:expand', expanded),
})
