#!/usr/bin/env node
/**
 * logger 死循环防护测试
 *
 * 曾经的死循环路径：
 *   report() → api.reportLog() 的 Promise 拒绝 → unhandledrejection
 *            → 又触发 report() → 又拒绝 → ……
 * 渲染进程被无限上报打满 → 编辑器卡死 → 「完全编辑不了」
 *
 * 现在 report() 里 catch 住拒绝，并且连续失败 N 次就停止上报。
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/verify-log-loop.js
 */
if (!process.versions.electron) {
  console.error('用 electron 跑');
  process.exit(1);
}
const path = require('path');
const util = require('util');
const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const { app, BrowserWindow } = require('electron');

const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(DEV, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  // 故意【不注册】log:report —— 模拟主进程 handler 缺失/抛错
  let unhandled = 0;
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && /No handler registered|log:report/.test(message)) unhandled++;
  });

  await win.loadFile(path.join(DEV, 'src', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 1000));

  // 连续触发 20 次未捕获异常 —— 每次都会走 report()
  await win.webContents.executeJavaScript(`(() => {
    for (let i = 0; i < 20; i++) {
      window.dispatchEvent(new ErrorEvent('error', {
        message: '压测用异常 ' + i, filename: 'test.js', lineno: i, colno: 1
      }));
    }
    return true;
  })()`);

  await new Promise(r => setTimeout(r, 1500));

  // 统计：unhandledrejection 应该没有失控
  const rejCount = await win.webContents.executeJavaScript(
    'String(window.__unhandledCount || 0)');

  check('没有大量 IPC 报错刷屏', unhandled < 50, 'IPC 报错 ' + unhandled + ' 次');
  check('未捕获拒绝没有失控', Number(rejCount) < 50, 'rejection ' + rejCount + ' 次');

  // 关键：渲染进程还活着吗
  const alive = await win.webContents.executeJavaScript(
    'String(!!window.__view && !!window.__view.state)');
  check('渲染进程还活着（编辑器没卡死）', alive === 'true', 'alive=' + alive);

  // 还能编辑吗
  const editable = await win.webContents.executeJavaScript(`(() => {
    const V = window.__view;
    V.dispatch({ changes: { from: 0, to: V.state.doc.length, insert: 'abc' },
                 selection: { anchor: 3 } });
    return V.state.doc.toString();
  })()`);
  check('异常之后仍能编辑', editable === 'abc', 'doc=' + JSON.stringify(editable));

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('  ✓ ' + r.name); }
    else { fail++; console.log('  ✗ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + results.length);
  setTimeout(() => app.exit(fail ? 1 : 0), 200);
});
