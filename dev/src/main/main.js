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
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: send('app:checkUpdate') },
        { type: 'separator' },
        { label: '关于轻墨', click: send('app:about') }
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

// 同步取版本号（渲染层启动时用）
ipcMain.on('app:getVersion', (e) => { e.returnValue = app.getVersion(); });

/* ============ 版本更新检测 ============ */
// 从 GitHub Releases 拉取最新版本信息
// 接口：GET https://api.github.com/repos/{owner}/{repo}/releases/latest
const UPDATE_REPO = 'engrecho/qingmo';
const UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

ipcMain.handle('app:checkUpdate', async () => {
  const current = app.getVersion();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(UPDATE_API, {
      signal: ctrl.signal,
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'QingMo-Update-Check'
      }
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, current, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const latest = String(data.tag_name || '').replace(/^v/i, '');
    if (!latest) return { ok: false, current, error: '未解析到版本号' };

    // 找当前平台的资源
    const isMac = process.platform === 'darwin';
    const isArm = process.arch === 'arm64';
    const assets = (data.assets || []).map(a => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url
    }));

    // 优先匹配当前平台
    let match = null;
    if (isMac) {
      match = assets.find(a => /mac.*(arm64|x64)/i.test(a.name) && (isArm ? /arm64/i.test(a.name) : /x64/i.test(a.name)))
             || assets.find(a => /mac/i.test(a.name));
    } else if (process.platform === 'win32') {
      match = assets.find(a => /\.exe$/i.test(a.name) && /setup/i.test(a.name))
             || assets.find(a => /\.exe$/i.test(a.name));
    }

    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersion(latest, current) > 0,
      releaseUrl: data.html_url,
      releaseName: data.name,
      notes: (data.body || '').slice(0, 2000),
      publishedAt: data.published_at,
      assets,
      match
    };
  } catch (e) {
    return { ok: false, current, error: e.name === 'AbortError' ? '请求超时' : e.message };
  }
});

/** 语义化版本比较：a > b 返回正数 */
function compareVersion(a, b) {
  const pa = String(a).split('.').map(x => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 在系统浏览器打开下载页 */
ipcMain.handle('app:openExternal', async (_e, url) => {
  // 只允许 http(s)，防止渲染层传入 file:// / javascript: 之类的协议
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

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