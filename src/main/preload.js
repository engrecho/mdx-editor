const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  open: () => ipcRenderer.invoke('fs:open'),
  openPath: (p) => ipcRenderer.invoke('fs:openPath', p),
  save: (p, c) => ipcRenderer.invoke('fs:save', p, c),
  saveAs: (c, name) => ipcRenderer.invoke('fs:saveAs', c, name),
  exportHtml: (html, name) => ipcRenderer.invoke('fs:exportHtml', html, name),
  rebuildMenu: () => ipcRenderer.invoke('app:rebuildMenu'),
  on: (ch, fn) => {
    const list = Array.isArray(ch) ? ch : [ch];
    list.forEach(c => ipcRenderer.on(c, (_e, arg) => fn(c, arg)));
  },
  platform: process.platform
});