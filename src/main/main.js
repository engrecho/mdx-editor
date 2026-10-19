const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;

// 应用图标：开发时读 build/icons，打包后读 resources 里的
function appIconPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'build', 'icons', 'icon-256.png'),
    path.join(process.resourcesPath || '', 'icons', 'icon-256.png')
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  return undefined;
}

// 最近打开文件（在 app ready 后初始化）
let recentList = [];
let recentFilePath = null;

function initRecent() {
  recentFilePath = path.join(app.getPath('userData'), 'recent.json');
  try {
    if (fs.existsSync(recentFilePath)) recentList = JSON.parse(fs.readFileSync(recentFilePath, 'utf-8')) || [];
  } catch (e) { recentList = []; }
}
function saveRecent() {
  try { fs.writeFileSync(recentFilePath, JSON.stringify(recentList.slice(0, 10), null, 2)); } catch (e) {}
}
function pushRecent(p) {
  if (!p) return;
  recentList = [p, ...recentList.filter(x => x !== p)].slice(0, 10);
  saveRecent();
}

function createWindow() {
  const icon = appIconPath();

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    show: false,
    backgroundColor: '#ffffff',
    title: '轻墨',
    icon: icon ? nativeImage.createFromPath(icon) : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.once('ready-to-show', () => win.show());

  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

const isMac = process.platform === 'darwin';

function buildMenu() {
  const send = (ch) => () => win && win.webContents.send(ch);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建', accelerator: 'CmdOrCtrl+N', click: send('cmd:new') },
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: send('cmd:open') },
        {
          label: '最近打开',
          submenu: recentList.length
            ? recentList.map(p => ({
                label: path.basename(p),
                click: () => { win.webContents.send('cmd:openPath', p); }
              }))
            : [{ label: '(无)', enabled: false }]
        },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: send('cmd:save') },
        { label: '另存为…', accelerator: 'CmdOrCtrl+Shift+S', click: send('cmd:saveAs') },
        { type: 'separator' },
        { label: '导出 HTML', accelerator: 'CmdOrCtrl+Shift+E', click: send('cmd:exportHtml') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: send('cmd:find') }
      ]
    },
    {
      label: '插入',
      submenu: [
        { label: '表格', accelerator: 'CmdOrCtrl+T', click: send('ins:table') },
        { label: '引用', accelerator: 'CmdOrCtrl+Shift+Q', click: send('ins:quote') },
        { label: '代码块', accelerator: 'CmdOrCtrl+Shift+K', click: send('ins:code') },
        { label: '无序列表', accelerator: 'CmdOrCtrl+Shift+8', click: send('ins:ul') },
        { label: '有序列表', accelerator: 'CmdOrCtrl+Shift+7', click: send('ins:ol') },
        { label: '任务列表', accelerator: 'CmdOrCtrl+Shift+9', click: send('ins:todo') },
        { type: 'separator' },
        { label: '分隔线', accelerator: 'CmdOrCtrl+Shift+M', click: send('ins:hr') },
        { label: '链接', accelerator: 'CmdOrCtrl+Shift+L', click: send('ins:link') },
        { label: '图片', accelerator: 'CmdOrCtrl+Shift+I', click: send('ins:image') }
      ]
    },
    {
      label: '格式',
      submenu: [
        { label: '粗体', accelerator: 'CmdOrCtrl+B', click: send('fmt:bold') },
        { label: '斜体', accelerator: 'CmdOrCtrl+I', click: send('fmt:italic') },
        { label: '行内代码', accelerator: 'CmdOrCtrl+E', click: send('fmt:code') },
        { label: '删除线', accelerator: 'CmdOrCtrl+Shift+X', click: send('fmt:strike') },
        { type: 'separator' },
        { label: 'H1', accelerator: 'CmdOrCtrl+Alt+1', click: send('fmt:h1') },
        { label: 'H2', accelerator: 'CmdOrCtrl+Alt+2', click: send('fmt:h2') },
        { label: 'H3', accelerator: 'CmdOrCtrl+Alt+3', click: send('fmt:h3') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '编辑器', accelerator: 'CmdOrCtrl+1', click: send('view:edit') },
        { label: '分栏', accelerator: 'CmdOrCtrl+2', click: send('view:split') },
        { label: '预览', accelerator: 'CmdOrCtrl+3', click: send('view:preview') },
        { type: 'separator' },
        { label: '切换深色模式', accelerator: 'CmdOrCtrl+D', click: send('view:theme') },
        { type: 'separator' },
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- IPC：文件操作 ---------------- */
ipcMain.handle('fs:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] }]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  pushRecent(p);
  return { path: p, content: fs.readFileSync(p, 'utf-8') };
});

ipcMain.handle('fs:openPath', async (_e, p) => {
  try {
    pushRecent(p);
    return { path: p, content: fs.readFileSync(p, 'utf-8') };
  } catch (err) { return { error: String(err) }; }
});

ipcMain.handle('fs:save', async (_e, p, content) => {
  fs.writeFileSync(p, content, 'utf-8');
  pushRecent(p);
  return { ok: true, path: p };
});

ipcMain.handle('fs:saveAs', async (_e, content, suggestedName) => {
  const r = await dialog.showSaveDialog(win, {
    title: '另存为',
    defaultPath: path.join(app.getPath('documents'), suggestedName || 'untitled.md'),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, content, 'utf-8');
  pushRecent(r.filePath);
  return { ok: true, path: r.filePath };
});

ipcMain.handle('fs:exportHtml', async (_e, html, suggestedName) => {
  const r = await dialog.showSaveDialog(win, {
    title: '导出 HTML',
    defaultPath: path.join(app.getPath('documents'), (suggestedName || 'untitled') + '.html'),
    filters: [{ name: 'HTML', extensions: ['html'] }]
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, html, 'utf-8');
  return { ok: true, path: r.filePath };
});

ipcMain.handle('app:rebuildMenu', () => { buildMenu(); return recentList; });

app.whenReady().then(() => {
  // 任务栏 / Dock 图标（Windows 主要看这个）
  const icon = appIconPath();
  if (icon) {
    try { app.setAppUserModelId('cn.bajiaolu.qingmo'); } catch (e) {}
    try {
      if (process.platform === 'win32') app.setIcon(nativeImage.createFromPath(icon));
      if (process.platform === 'darwin') app.dock.setIcon(nativeImage.createFromPath(icon));
    } catch (e) {}
  }

  initRecent();
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => { if (!isMac) app.quit(); });