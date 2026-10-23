#!/usr/bin/env node
/**
 * 键盘交互真机测试（Enter / Backspace / Tab）
 *
 * 在真实 Electron 窗口里模拟按键，验证 markdownKeymap 真的生效。
 * 与 test-editor-core.js 的分工：
 *   · test-editor-core  测纯函数（毫秒级，改逻辑立刻能验）
 *   · 本脚本             测 keymap 是否真的接上了（要起 Electron）
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/verify-keys.js
 */
if (!process.versions.electron) {
  console.error('用 electron 跑');
  process.exit(1);
}

const path = require('path');
const fs = require('fs');
const util = require('util');
const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(DEV, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  await win.loadFile(path.join(DEV, 'src', 'renderer', 'index.html'), { query: { test: '1', t: String(Date.now()) } });
  await new Promise(r => setTimeout(r, 900));

  const runnerSrc = fs.readFileSync(path.join(DEV, 'tests', 'syntax', 'run-keys.js'), 'utf8')
    .trim().replace(/;\s*$/, '');
  const pageScript = `(function(){
    try {
      return (${runnerSrc})();
    } catch (e) {
      window.__lastError = (e && e.stack) || String(e);
      throw e;
    }
  })()`;

  let rows = [];
  try {
    rows = await win.webContents.executeJavaScript(pageScript, true);
  } catch (e) {
    log('X 页面脚本失败: ' + (e && e.message));
    try {
      const d = await win.webContents.executeJavaScript('String(window.__lastError || "")', true);
      log('  ' + d);
    } catch (e2) { /* 忽略 */ }
    setTimeout(() => app.exit(1), 100);
    return;
  }

  let pass = 0, fail = 0;
  let cur = '';
  for (const r of rows) {
    if (r.name.startsWith('──')) { console.log('\n' + r.name); cur = r.name; continue; }
    if (r.pass) { pass++; console.log('  ✓ ' + r.name + (r.detail ? '  ' + r.detail : '')); }
    else {
      fail++;
      console.log('  ✗ ' + r.name);
      console.log('      ' + String(r.detail).split('\n').join('\n      '));
    }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + rows.length);
  if (fail) { console.log('失败 ' + fail); setTimeout(() => app.exit(1), 100); return; }
  console.log('✅ 全部通过');
  setTimeout(() => app.exit(0), 100);
});
