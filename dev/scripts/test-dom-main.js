/**
 * test-dom.js 的 Electron 端：加载测试页，把结果写回 JSON。
 *
 * 由 test-dom.js spawn，不单独运行。
 */
const path = require('path');
const fs = require('fs');

// 路径通过环境变量传，不解析 argv —— Electron 主进程的 argv 结构与
// Node 不同（argv[0]/argv[1] 不一定是脚本路径），解析容易踩坑。
const HTML = process.env.TEST_DOM_HTML;
const RESULT = process.env.TEST_DOM_RESULT;
const TIMEOUT = 90000;

if (!HTML || !RESULT) {
  console.error('X 缺少 TEST_DOM_HTML / TEST_DOM_RESULT 环境变量');
  process.exit(1);
}

// Electron 主进程入口：require('electron') 拿到的 app 在模块加载时就可用的
// 前提是这个脚本本身由 electron.exe 执行。这里显式走一次，失败就给明确报错。
let electron;
try {
  electron = require('electron');
} catch (e) {
  console.error('X require("electron") 失败: ' + e.message);
  process.exit(1);
}
const { app, BrowserWindow } = electron || {};
if (!app) {
  console.error('X electron.app 为空 —— 这个脚本必须由 electron.exe 运行，不是 node.exe');
  console.error('  process.versions.electron = ' + (process.versions.electron || '(空)'));
  process.exit(1);
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
// 这台机器没有可用 GPU（GPU 进程会崩成 FATAL），把 GPU 拉进主进程
app.commandLine.appendSwitch('in-process-gpu');

let win = null;
let done = false;

function finish(code) {
  if (done) return;
  done = true;
  try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) {}
  setTimeout(() => app.exit(code), 50).unref();
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on('console-message', (e, level, message, line, src) => {
    // 把渲染进程的 console.error 透传出来，方便调试
    if (level >= 2) console.error('[renderer] ' + message);
  });
  win.webContents.on('render-process-gone', (e, d) => {
    console.error('X 渲染进程崩溃: ' + (d && d.reason));
    finish(1);
  });
  // 未捕获异常：写进结果文件，让 runner 能看到具体堆栈
  win.webContents.on('uncaught-exception', (e, info) => {
    console.error('[renderer] 未捕获异常: ' + (info && info.error || info));
    try {
      fs.writeFileSync(RESULT, JSON.stringify({
        results: [{ name: 'HARNESS-UNCAUGHT', pass: false,
                    detail: String((info && info.error && info.error.stack) || info || 'unknown') }],
        pass: 0, fail: 1, total: 1
      }), 'utf8');
    } catch (e2) {}
    finish(1);
  });

  try {
    await win.loadFile(HTML);
  } catch (e) {
    console.error('X 加载测试页失败: ' + e.message);
    finish(1);
    return;
  }

  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    let out = null;
    try {
      out = await win.webContents.executeJavaScript(
        'window.__TEST_DONE__ ? JSON.stringify(window.__TEST_RESULTS__) : null');
    } catch (e) {
      console.error('X 执行测试代码失败: ' + e.message);
      finish(1);
      return;
    }
    if (out) {
      try {
        fs.writeFileSync(RESULT, out, 'utf8');
      } catch (e) {
        console.error('X 写结果失败: ' + e.message);
        finish(1);
        return;
      }
      finish(0);
      return;
    }
    await new Promise(r => setTimeout(r, 150));
  }

  console.error('X 测试超时');
  finish(1);
});

app.on('window-all-closed', () => finish(1));
setTimeout(() => { console.error('X 主进程超时'); finish(1); }, TIMEOUT + 20000).unref();
