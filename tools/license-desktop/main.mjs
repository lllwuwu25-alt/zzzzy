import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createIssuerService } from './service.mjs'
import { METHODS, secureWindowOptions, hardenContents, dispatchCall, applicationProtectedRoots } from './security.mjs'

app.setName('错题本发码器')
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), 'local.mistake.notebook.issuer'))
app.enableSandbox()
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
else {
  let window, service, closing = false
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus() } })
  app.whenReady().then(async () => {
  const expectedUrl = pathToFileURL(join(import.meta.dirname, 'ui/index.html')).href
  const chooseOutput = async ({ kind, defaultName }) => {
    const result = await dialog.showSaveDialog(window, { title: kind === 'backup' ? '备份加密保险库' : kind === 'public-config' ? '导出发行公钥' : '导出设备授权', defaultPath: join(app.getPath('documents'), defaultName), filters: [{ name: 'JSON 文件', extensions: ['json'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] })
    return result.canceled ? null : result.filePath
  }
  service = createIssuerService({
    protectedRoots: applicationProtectedRoots({ appPath: app.getAppPath(), resourcesPath: process.resourcesPath, executablePath: process.execPath, isPackaged: app.isPackaged, repositoryRoot: resolve(import.meta.dirname, '../..') }),
    dialogs: {
      chooseOutput,
      async chooseVault({ create }) {
        if (create) {
          const result = await dialog.showSaveDialog(window, { title: '创建新的加密保险库（不要覆盖旧文件）', defaultPath: join(app.getPath('documents'), '错题本授权管理', 'issuer.vault.json'), filters: [{ name: '加密保险库', extensions: ['json'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] })
          return result.canceled ? null : result.filePath
        }
        const result = await dialog.showOpenDialog(window, { title: '打开已有加密保险库', defaultPath: app.getPath('documents'), properties: ['openFile'], filters: [{ name: '加密保险库', extensions: ['json'] }] })
        return result.canceled ? null : result.filePaths[0]
      },
      async chooseRequest() {
        const result = await dialog.showOpenDialog(window, { title: '选择用户的激活申请', properties: ['openFile'], filters: [{ name: '错题本激活申请', extensions: ['json'] }] })
        return result.canceled ? null : result.filePaths[0]
      },
    },
  })
  window = new BrowserWindow(secureWindowOptions(join(import.meta.dirname, 'preload.cjs')))
  hardenContents(window.webContents, expectedUrl)
  for (const method of METHODS) ipcMain.handle(`issuer:${method}`, (event, args) => dispatchCall(service, method, args, {
    frameUrl: event.senderFrame?.url, expectedUrl,
    isMainFrame: event.sender === window?.webContents && event.senderFrame === window?.webContents.mainFrame && !closing,
  }))
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '错题本发码器', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit', label: '锁定并退出' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '显示', submenu: [{ role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }] },
  ]))
  window.once('ready-to-show', () => window.show())
  window.on('close', event => {
    event.preventDefault()
    if (closing) return
    closing = true
    service.lock().finally(() => { window.destroy(); window = undefined; app.quit() })
  })
  app.on('before-quit', event => { if (window && !closing) { event.preventDefault(); window.close() } })
  app.on('window-all-closed', () => app.quit())
  await window.loadURL(expectedUrl)
  }).catch(() => { dialog.showErrorBox('错题本发码器未能启动', '本地界面加载失败，请重新安装或联系维护者。保险库不会被重置。'); app.exit(1) })
}
