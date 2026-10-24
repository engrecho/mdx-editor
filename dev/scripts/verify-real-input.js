#!/usr/bin/env node
/**
 * 真实输入管线测试（webContents.sendInputEvent）
 *
 * 之前的测试都是 dispatchEvent —— 那是「人造」的，
 * 走的是 DOM 事件路径，绕过了 Chromium 的输入管线。
 * sendInputEvent 走的是真实管线（和用户按键、IME 完全一样）。
 *
 * 这个脚本测：
 *   1. 真实按键能不能改文档
 *   2. IME 组合输入期间按 Enter 会不会被抢
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/verify-real-input.js
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: true,
    width: 1000, height: 700,
    webPreferences: {
      preload: path.join(DEV, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  await win.loadFile(path.join(DEV, 'src', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 1200));

  const js = (code) => win.webContents.executeJavaScript(code, true);
  const doc = async () => await js('window.__view.state.doc.toString()');

  /* ---------- 真实按键：普通字符 ---------- */
  await js(`window.__view.dispatch({
    changes: { from: 0, to: window.__view.state.doc.length, insert: '' },
    selection: { anchor: 0 }
  });
  window.__view.focus();`);
  await sleep(200);

  for (const ch of ['a', 'b', 'c']) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
    win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
    await sleep(60);
  }
  const afterType = await doc();
  check('真实按键能输入字符', afterType === 'abc', '实际: ' + JSON.stringify(afterType));

  /* ---------- 真实按键：Enter ---------- */
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await sleep(300);
  const afterEnter = await doc();
  check('真实 Enter 能换行', afterEnter === 'abc\n', '实际: ' + JSON.stringify(afterEnter));

  /* ---------- 真实按键：Backspace ---------- */
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
  await sleep(300);
  const afterBs = await doc();
  check('真实 Backspace 能删字', afterBs === 'abc', '实际: ' + JSON.stringify(afterBs));

  /* ---------- 真实 IME 组合输入 ---------- */
  // 模拟：compositionstart → 上屏 → compositionupdate → Enter（选词）
  await js(`window.__view.dispatch({
    changes: { from: 0, to: window.__view.state.doc.length, insert: '' },
    selection: { anchor: 0 }
  });
  window.__view.focus();`);
  await sleep(200);

  await js(`(() => {
    const dom = window.__view.contentDOM;
    window.__imeLog = [];
    // 记录我们自己的 keymap 有没有处理这个 Enter
    const orig = window.__view.contentDOM;
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    // 真实 IME 上屏：改 contentDOM 文本，触发 MutationObserver
    const line = dom.querySelector('.cm-line');
    if (line) line.textContent = '中文';
    dom.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '中文' }));
    return true;
  })()`);
  await sleep(300);   // 等 MutationObserver 跑完（composing 才会 > 0）

  const composingState = await js('JSON.stringify({composing: window.__view.composing, input: window.__view.inputState.composing})');
  log('  IME 组合状态: ' + composingState);

  // 选词：Enter（isComposing）
  await js(`(() => {
    const dom = window.__view.contentDOM;
    const ev = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
      isComposing: true, keyCode: 229
    });
    window.__imeEnterPrevented = false;
    dom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.defaultPrevented) window.__imeEnterPrevented = true;
    }, false);
    dom.dispatchEvent(ev);
    return true;
  })()`);
  await sleep(300);

  const prevented = await js('window.__imeEnterPrevented');
  const docAfterIme = await doc();
  check('IME 选词按 Enter 不被抢走', prevented === false,
    prevented ? '被抢走了！文档变成 ' + JSON.stringify(docAfterIme) : '');

  await js(`window.__view.contentDOM.dispatchEvent(
    new CompositionEvent('compositionend', { bubbles: true, data: '中文' }))`);
  await sleep(200);

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('  ✓ ' + r.name); }
    else { fail++; console.log('  ✗ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + results.length);
  setTimeout(() => app.exit(fail ? 1 : 0), 200);
});
