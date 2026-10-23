const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  open: () => ipcRenderer.invoke('fs:open'),
  openPath: (p) => ipcRenderer.invoke('fs:openPath', p),
  save: (p, c) => ipcRenderer.invoke('fs:save', p, c),
  saveAs: (c, name) => ipcRenderer.invoke('fs:saveAs', c, name),
  exportHtml: (html, name) => ipcRenderer.invoke('fs:exportHtml', html, name),
  rebuildMenu: () => ipcRenderer.invoke('app:rebuildMenu'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  // 诊断日志：渲染进程把异常送回主进程统一落盘
  reportLog: (payload) => ipcRenderer.invoke('log:report', payload),
  exportLog: () => ipcRenderer.invoke('log:export'),
  tailLog: () => ipcRenderer.invoke('log:tail'),
  // 文件关联检查与修复（「双击 md 打不开」时用来定位）
  checkFileAssoc: () => ipcRenderer.invoke('app:checkFileAssoc'),
  repairFileAssoc: () => ipcRenderer.invoke('app:repairFileAssoc'),
  version: () => ipcRenderer.sendSync('app:getVersion'),
  on: (ch, fn) => {
    const list = Array.isArray(ch) ? ch : [ch];
    list.forEach(c => ipcRenderer.on(c, (_e, arg) => fn(c, arg)));
  },
  platform: process.platform
});