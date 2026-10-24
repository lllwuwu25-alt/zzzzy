const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('issuer', Object.freeze({
  snapshot: () => ipcRenderer.invoke('issuer:snapshot', {}),
  createVault: args => ipcRenderer.invoke('issuer:createVault', args),
  openVault: args => ipcRenderer.invoke('issuer:openVault', args),
  createPurchase: args => ipcRenderer.invoke('issuer:createPurchase', args),
  readRequest: () => ipcRenderer.invoke('issuer:readRequest', {}),
  issue: args => ipcRenderer.invoke('issuer:issue', args),
  replace: args => ipcRenderer.invoke('issuer:replace', args),
  exportPublicConfig: () => ipcRenderer.invoke('issuer:exportPublicConfig', {}),
  backupVault: () => ipcRenderer.invoke('issuer:backupVault', {}),
  lock: () => ipcRenderer.invoke('issuer:lock', {}),
}))
