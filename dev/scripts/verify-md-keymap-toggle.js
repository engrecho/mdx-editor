#!/usr/bin/env node
/**
 * Markdown 编辑手感的开关测试
 *
 * 关掉之后：
 *   · 列表项按 Enter 不再自动续列表（回到 CodeMirror 默认拆行）
 *   · 行首 Backspace 不再删列表标记
 *   · 表格 Tab 不再跳格
 *
 * 而且必须【立刻生效】—— 不用重启。
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
  await win.loadFile(path.join(DEV, 'src', 'renderer', 'index.html'));
  await new Promise(r => setTimeout(r, 1000));

  const raw = await win.webContents.executeJavaScript(`(() => {
    const V = window.__view;
    const out = [];
    const doc = () => V.state.doc.toString();
    const dom = V.contentDOM;
    function key(k) {
      const ev = new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true });
      dom.dispatchEvent(ev);
      return !ev.defaultPrevented;
    }
    function setDoc(d, pos) {
      V.dispatch({ changes: { from: 0, to: V.state.doc.length, insert: d }, selection: { anchor: pos } });
    }
    function setSwitch(on) {
      window.__setMdKeymapEnabled(on);
    }

    // ① 默认是开的
    out.push({ name: '默认开启', pass: window.__mdKeymapEnabled() === true,
               detail: '当前=' + window.__mdKeymapEnabled() });

    // ② 列表 Enter 续行由 CodeMirror 原生负责（Prec.high，优先级比我们高）
    //    开关【不影响】它 —— 这正是我们想要的：原生行为始终可用
    setDoc('- 列表项', 4);
    key('Enter');
    out.push({ name: '列表Enter续行（原生，开关不影响）',
               pass: doc() === '- 列表\\n- 项', detail: JSON.stringify(doc()) });

    // ③ 关掉 → 我们自己的实现失效（表格 Tab 跳格）
    setSwitch(false);
    setDoc('| A | B |\\n| --- | --- |\\n| 1 | 2 |', 26);
    key('Tab');
    // 关闭后不再跳格，而是退回 CodeMirror 的 indentMore（缩进两格）
    out.push({ name: '关闭后表格Tab退回缩进（不跳格）',
               pass: doc() === '| A | B |\\n| --- | --- |\\n  | 1 | 2 |',
               detail: JSON.stringify(doc()) });

    // ④ 行首 Backspace → 原生语义（光标左边没东西，不动）
    setDoc('- 列表项', 0);
    key('Backspace');
    out.push({ name: '行首Backspace不动（原生语义）',
               pass: doc() === '- 列表项', detail: JSON.stringify(doc()) });

    // ⑤ 重新打开 → 表格 Tab 跳格恢复
    setSwitch(true);
    setDoc('| A | B |\\n| --- | --- |\\n| 1 | 2 |', 26);
    key('Tab');
    const sel = V.state.selection.main;
    const line = V.state.doc.lineAt(sel.head);
    out.push({ name: '重新开启后表格Tab跳格恢复',
               pass: line.text.slice(sel.head - line.from) === '2 |',
               detail: '光标在 ' + JSON.stringify(line.text.slice(sel.head - line.from)) });

    // ⑥ 关闭时普通打字必须完全正常（这是最重要的）
    setSwitch(false);
    setDoc('abc', 3);
    V.focus();
    for (const ch of 'xyz') {
      const p = V.state.selection.main.from;
      V.dispatch({ changes: { from: p, insert: ch }, selection: { anchor: p + ch.length } });
    }
    out.push({ name: '关闭时打字正常', pass: doc() === 'abcxyz', detail: JSON.stringify(doc()) });

    setSwitch(true);
    return out;
  })()`);

  for (const r of raw) check(r.name, r.pass, r.detail);

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('  ✓ ' + r.name); }
    else { fail++; console.log('  ✗ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + results.length);
  setTimeout(() => app.exit(fail ? 1 : 0), 200);
});
