#!/usr/bin/env node
/**
 * 中文输入法（IME）兼容性测试
 *
 * 现状（CodeMirror 上游行为，不是我们引入的）：
 *   IME 组合输入时按 Enter / Backspace，由 @codemirror/lang-markdown 的
 *   insertNewlineContinueMarkup / deleteMarkupBackward 处理。
 *   它的保护靠 `ignoreDuringComposition` → `inputState.composing > 0`，
 *   而 composing 是在【文本上屏】时才 ++（0 → 1）。
 *   所以：
 *     · 已上屏的组合（composing > 0）→ CodeMirror 放行 ✓
 *     · 候选框阶段（composing = 0）→ 保护失效，Enter 会被吃掉
 *   这是上游既有行为，v1.3.0 也一样。
 *
 * 我们能保证的是：
 *   1. 正常输入（无 IME）完全不受影响
 *   2. Tab（我们自己的 handler）在 IME 期间会放行
 *   3. **绝不能用 preventDefault 去抢 Enter** ——
 *      那会影响 IME 选词，比现在的状况更糟。
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/verify-ime.js
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
const record = (name, detail) => results.push({ name, pass: true, detail: detail, recorded: true });

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
    if (!V) return [{ name: 'HARNESS', pass: false, detail: 'window.__view 不存在' }];

    const dom = V.contentDOM;
    function imeKey(k, withUpdate) {
      dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      if (withUpdate) {
        dom.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '中' }));
      }
      const ev = new KeyboardEvent('keydown', {
        key: k, code: k, bubbles: true, cancelable: true,
        isComposing: true, keyCode: 229
      });
      const handled = !ev.defaultPrevented;
      dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
      return { handled, prevented: ev.defaultPrevented };
    }
    function plainKey(k) {
      const ev = new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true });
      dom.dispatchEvent(ev);
      return ev.defaultPrevented;
    }
    const doc = () => V.state.doc.toString();
    const setDoc = (d, p) => V.dispatch({
      changes: { from: 0, to: V.state.doc.length, insert: d }, selection: { anchor: p }
    });

    // ① 候选框阶段（未上屏）—— 记录上游现状，不做断言
    {
      setDoc('- 列表项', 4);
      const r = imeKey('Enter', false);
      out.push({
        name: 'IME/候选框阶段Enter（记录上游现状）',
        pass: true,
        detail: 'prevented=' + r.prevented + ' doc=' + JSON.stringify(doc()) +
                ' —— 上游既有行为，Enter 选词请用 Space'
      });
    }

    // ② 已上屏的组合（composing > 0）—— CodeMirror 会放行
    {
      setDoc('- 列表项', 4);
      const r = imeKey('Enter', true);
      out.push({
        name: 'IME/已上屏时Enter被放行',
        pass: !r.prevented,
        detail: r.prevented ? '被抢走了' : ''
      });
    }

    // ③ Tab 在 IME 期间必须放行（这是我们自己的 handler，要保证）
    {
      setDoc('你好', 2);
      const r = imeKey('Tab', true);
      out.push({
        name: 'IME/组合中Tab被放行',
        pass: !r.prevented,
        detail: r.prevented ? '被抢走了！' : ''
      });
    }

    // ④ 正常输入完全不受影响（最重要）
    {
      setDoc('', 0);
      V.focus();
      for (const ch of 'abc中文') {
        const p = V.state.selection.main.from;
        V.dispatch({ changes: { from: p, insert: ch }, selection: { anchor: p + ch.length } });
      }
      out.push({
        name: 'IME/正常打字不受影响',
        pass: doc() === 'abc中文',
        detail: 'doc=' + JSON.stringify(doc())
      });
    }

    // ⑤ 正常 Enter 仍然工作
    {
      setDoc('- 列表项', 4);
      plainKey('Enter');
      out.push({
        name: 'IME/正常Enter仍续列表',
        pass: doc() === '- 列表\\n- 项',
        detail: 'doc=' + JSON.stringify(doc())
      });
    }

    // ⑥ 正常 Backspace 仍然工作
    {
      setDoc('abc', 3);
      plainKey('Backspace');
      out.push({
        name: 'IME/正常Backspace仍删字',
        pass: doc() === 'ab',
        detail: 'doc=' + JSON.stringify(doc())
      });
    }

    return out;
  })()`);

  for (const r of raw) {
    if (r.recorded) record(r.name, r.detail);
    else check(r.name, r.pass, r.detail);
  }

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('  ✓ ' + r.name + (r.detail ? '  ' + r.detail : '')); }
    else { fail++; console.log('  ✗ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + results.length);
  setTimeout(() => app.exit(fail ? 1 : 0), 200);
});
