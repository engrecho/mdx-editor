#!/usr/bin/env node
/**
 * 「双击打开文件」真机测试
 *
 * 模拟用户双击 md 文件的全链路：
 *   1. 命令行带路径启动 → 主进程 argv 扫描 → 投喂渲染层
 *   2. 渲染层收到 cmd:openPath → 调 fs:openPath → 新标签打开
 *
 * 这个链路之前全是静默失败点（return false 不留任何痕迹）。
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/verify-open-file.js <md文件>
 */
if (!process.versions.electron) {
  console.error('用 electron 跑');
  process.exit(1);
}

const path = require('path');
const fs = require('fs');
const os = require('os');
const util = require('util');
const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const { app, BrowserWindow, ipcMain } = require('electron');
const logger = require(path.join(DEV, 'src', 'main', 'logger.js'));

const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' });

// 造一个临时 md 文件
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qingmo-test-'));
const MD = path.join(TMPDIR, '测试文档.md');
const CONTENT = '# 标题\n\n这是一段**加粗**内容。\n\n- 列表项一\n- 列表项二\n';
fs.writeFileSync(MD, CONTENT, 'utf8');

app.whenReady().then(async () => {
  logger.init(app);

  const DOC_EXTS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdtxt', '.mdtext', '.text', '.txt']);
  const isDocPath = (p) => typeof p === 'string' && DOC_EXTS.has(path.extname(p).toLowerCase());

  // 模拟主进程的 argv 扫描
  check('测试文件扩展名被识别', isDocPath(MD), MD);
  check('非文档扩展名被拒绝', !isDocPath(MD + '.txtx'), '');
  check('非字符串被拒绝', !isDocPath(null), '');

  check('测试文件存在', fs.existsSync(MD), MD);

  // 起一个窗口，模拟渲染层
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(DEV, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  await win.loadFile(path.join(DEV, 'src', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 900));

  // 主进程侧的 fs:openPath（这里自己注册一份，跟 main.js 一样）
  ipcMain.handle('fs:openPath', async (_e, p) => {
    try {
      logger.info('fs:openPath 读取文件', { path: p });
      const content = fs.readFileSync(p, 'utf-8');
      return { path: p, content };
    } catch (err) {
      logger.error('fs:openPath 读取失败', { path: p, message: err.message });
      return { error: String(err) };
    }
  });
  ipcMain.handle('log:report', (_e, payload) => { logger.fromRenderer(payload); return true; });

  // 让渲染层收到 cmd:openPath
  win.webContents.send('cmd:openPath', MD);
  await new Promise(r => setTimeout(r, 900));

  // 检查渲染层是否真的打开了
  const state = await win.webContents.executeJavaScript(`(() => {
    const t = window.__view ? { getDoc: () => window.__view.state.doc.toString() } : null;
    return JSON.stringify({
      doc: t ? t.getDoc().slice(0, 120) : "(无 __view)",
      tabs: (window.__tabs ? window.__tabs.length : -1),
      title: document.title
    });
  })()`);
  const s = JSON.parse(state);
  check('渲染层读到了文件内容', s.doc.includes('这是一段'), JSON.stringify(s.doc));

  // 失败的路径也要被记录
  logger.fileOpenAttempt(MD, true, '已投喂渲染层');
  logger.fileOpenAttempt('/nope/x.md', false, '文件不存在');
  logger.fileOpenAttempt('/nope/x.txtx', false, '扩展名不支持');
  logger.flush();

  const logText = logger.tail(100);
  check('成功打开已记录', logText.includes('已投喂渲染层'), '');
  check('文件不存在已记录', logText.includes('文件不存在'), '');
  check('扩展名不支持已记录', logText.includes('扩展名不支持'), '');

  // 渲染层打开的文件内容也要在日志里（fs:openPath 那条）
  check('打开过程已记录', logText.includes('fs:openPath'), '');

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('  ✓ ' + r.name); }
    else { fail++; console.log('  ✗ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + results.length);
  console.log('日志文件: ' + logger.file());

  // 清理临时文件
  try { fs.rmSync(TMPDIR, { recursive: true, force: true }); } catch (e) {}

  setTimeout(() => app.exit(fail ? 1 : 0), 200);
});
