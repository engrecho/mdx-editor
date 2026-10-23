/**
 * 页面里跑的键盘交互测试。单独放文件，避免模板字符串转义问题。
 *
 * 用 CodeMirror 的 API 模拟按键（view.dispatch + 自定义 transaction），
 * 实际走的是 markdownKeymap 里注册的 handler。
 */
(function () {
  const Q = window.__qingmo, V = window.__view;
  const out = [];
  const eq = (name, actual, expected) => {
    const pass = actual === expected;
    out.push({ name, pass, detail: pass ? '' : ('期望 ' + JSON.stringify(expected) + ' / 实际 ' + JSON.stringify(actual)) });
  };
  const ok = (name, pass, detail) => out.push({ name, pass: !!pass, detail: detail || '' });

  /** 模拟按某个键：走 CodeMirror 的 keymap 解析 */
  function pressKey(key, shift) {
    // 用一个假的 keydown 事件触发 keymap
    const ev = new KeyboardEvent('keydown', {
      key, code: key, bubbles: true, cancelable: true,
      shiftKey: !!shift, ctrlKey: false, altKey: false, metaKey: false
    });
    // CodeMirror 监听的是 editor DOM 上的 keydown
    const dom = V.dom.querySelector('.cm-content') || V.dom;
    dom.dispatchEvent(ev);
    return !ev.defaultPrevented;   // true = 处理了
  }

  /** 设置文档 + 光标（按绝对位置） */
  function setup(doc, pos, head) {
    Q.setDoc(doc, pos);
    if (head != null) V.dispatch({ selection: { anchor: pos, head } });
  }
  /** 设置文档 + 光标（按行号 + 列号，1 起） */
  function setupAt(doc, lineNo, col, headCol) {
    Q.setDoc(doc, 0);
    const L = V.state.doc.line(lineNo);
    const p = L.from + col;
    V.dispatch({ selection: { anchor: p, head: headCol != null ? L.from + headCol : p } });
  }

  const lines = s => s.split('\n');

  /* ============ A. Enter 续列表 ============ */
  {
    setup('- 列表项', 5);
    pressKey('Enter');
    eq('A/无序列表Enter续行', Q.getDoc(), '- 列表项\n- ');
  }
  {
    setup('1. 第一项', 6);
    pressKey('Enter');
    eq('A/有序列表Enter编号递增', Q.getDoc(), '1. 第一项\n2. ');
  }
  {
    setup('3. 第三项', 6);
    pressKey('Enter');
    eq('A/有序列表接续编号', Q.getDoc(), '3. 第三项\n4. ');
  }
  {
    setup('- [ ] 待办', 8);
    pressKey('Enter');
    eq('A/任务列表Enter续行', Q.getDoc(), '- [ ] 待办\n- [ ] ');
  }
  {
    setup('- [x] 完成', 8);
    pressKey('Enter');
    eq('A/已完成任务Enter新任务', Q.getDoc(), '- [x] 完成\n- [ ] ');
  }
  {
    setup('- 父项\n  - 子项', 11);
    pressKey('Enter');
    eq('A/嵌套列表保持缩进', Q.getDoc(), '- 父项\n  - 子项\n  - ');
  }
  {
    setup('> 引用', 4);
    pressKey('Enter');
    eq('A/引用Enter续行', Q.getDoc(), '> 引用\n> ');
  }
  {
    setup('- ', 2);
    pressKey('Enter');
    eq('A/空列表项Enter结束列表', Q.getDoc(), '');
  }
  {
    setup('普通文字', 4);
    pressKey('Enter');
    eq('A/普通段落Enter拆行', Q.getDoc(), '普通文字\n');
  }
  {
    setup('前半\n后半', 3);
    pressKey('Enter');
    eq('A/行中Enter拆行', Q.getDoc(), '前半\n\n后半');
  }

  /* ============ B. Backspace 取消标记 ============ */
  {
    setup('- 列表项', 0);
    pressKey('Backspace');
    eq('B/行首Backspace删列表标记', Q.getDoc(), '列表项');
  }
  {
    setup('> 引用', 0);
    pressKey('Backspace');
    eq('B/行首Backspace删引用标记', Q.getDoc(), '引用');
  }
  {
    setup('## 标题', 0);
    pressKey('Backspace');
    eq('B/行首Backspace删标题标记', Q.getDoc(), '标题');
  }
  {
    setup('  - 子项', 0);
    pressKey('Backspace');
    eq('B/行首Backspace先减缩进', Q.getDoc(), '- 子项');
  }
  {
    setup('- 列表项', 5);
    pressKey('Backspace');
    eq('B/非行首Backspace正常删字', Q.getDoc(), '- 列表');
  }

  /* ============ C. Tab 在表格里跳格 ============ */
  {
    setupAt('| A | B |\n| --- | --- |\n| 1 | 2 |', 3, 2);
    pressKey('Tab');
    // 光标应该跳到第二格
    const sel = V.state.selection.main;
    const line = V.state.doc.lineAt(sel.head);
    eq('C/表格Tab跳下一格', line.text.slice(sel.head - line.from), '2 |');
  }
  {
    setupAt('| A | B |\n| --- | --- |\n| 1 | 2 |', 3, 6);
    pressKey('Tab');
    // 最后一格按 Tab → 加一行
    eq('C/表格末格Tab加行', Q.getDoc().split('\n').length, 4);
  }
  {
    setup('- 列表项', 0);
    pressKey('Tab');
    eq('C/列表Tab变子项', Q.getDoc(), '  - 列表项');
  }

  /* ============ D. 不该被拦截的情况 ============ */
  {
    setup('普通文字', 4);
    pressKey('Enter');
    eq('D/普通段落Enter正常', Q.getDoc(), '普通文字\n');
  }
  {
    setup('文字', 2);
    pressKey('Backspace');
    eq('D/普通文字Backspace正常', Q.getDoc(), '文');
  }
  {
    setupAt('| A | B |\n| --- | --- |\n| 1 | 2 |', 3, 2);
    pressKey('Enter');
    eq('D/表格内Enter不插行', Q.getDoc().split('\n').length, 3);
  }

  return out;
});
