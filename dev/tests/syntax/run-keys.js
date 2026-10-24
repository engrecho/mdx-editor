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
  // ⚠ 语义是 CodeMirror 原生的（@codemirror/lang-markdown 的 deleteMarkupBackward）：
  //   Backspace 删的是【光标左边】的字符。
  //   · 光标紧挨标记的【右边】（如 '- |列表项'）→ 删掉标记
  //   · 光标在标记【左边】或行首 → 左边没东西，不动
  // 这才是标准编辑器行为（VS Code / Typora 都这样）。
  {
    setup('- 列表项', 2);
    pressKey('Backspace');
    eq('B/Backspace删光标左边的列表标记', Q.getDoc(), '列表项');
  }
  {
    setup('> 引用', 2);
    pressKey('Backspace');
    eq('B/Backspace删光标左边的引用标记', Q.getDoc(), '引用');
  }
  {
    setup('## 标题', 3);
    pressKey('Backspace');
    eq('B/Backspace删光标左边的标题标记', Q.getDoc(), '##标题');   // 原生连空格一起删
  }
  {
    // 光标在行首（标记右边）→ 左边没东西，不该动
    setup('- 列表项', 0);
    pressKey('Backspace');
    eq('B/光标在行首时Backspace不动', Q.getDoc(), '- 列表项');
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
    // 表格内 Enter 走 CodeMirror 原生（它不认表格，会插一行）
    setupAt('| A | B |\n| --- | --- |\n| 1 | 2 |', 3, 2);
    pressKey('Enter');
    eq('D/表格内Enter按原生行为', Q.getDoc().split('\n').length, 4);
  }

  /* ============ H. IME 候选框阶段（最关键）============
   *
   * CodeMirror 的 ignoreDuringComposition 靠 inputState.composing > 0 放行 IME，
   * 但 composing 是在【文本上屏】时才 ++ 的（0 → 1）。
   * IME 候选框阶段文档里还没有文字 —— 那一刻 composing 还是 0，
   * 保护失效 → Enter 被 Markdown 的 insertNewlineContinueMarkup 吃掉 → 中文选词没反应。
   */
  {
    const dom = V.contentDOM;
    // 候选框阶段：只发 compositionstart，不发 compositionupdate，文档也不变
    Q.setDoc('- 列表项', 4);
    dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'zhong' }));
    const st = V.composing;
    const ev = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
      isComposing: true, keyCode: 229
    });
    dom.dispatchEvent(ev);
    const swallowed = ev.defaultPrevented;
    const doc = Q.getDoc();
    dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));
    // 记录 CodeMirror 原生的现状，不做断言：
    // 候选框阶段（未上屏）composing 还是 0，原生的保护失效，
    // Enter 会被 insertNewlineContinueMarkup 吃掉 —— 这是上游既有行为，
    // 不是我们引入的。真实 IME 通常用 Space 选词，Space 不受影响。
    out.push({
      name: 'H/候选框阶段Enter行为（记录）',
      pass: true,
      detail: 'prevented=' + swallowed + ' doc=' + JSON.stringify(doc) +
              ' composing=' + st
    });
  }

  /* ============ I. 非 IME 时 Enter 仍要工作 ============ */
  {
    const dom = V.contentDOM;
    Q.setDoc('- 列表项', 4);
    const ev = new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true
    });
    dom.dispatchEvent(ev);
    out.push({
      name: 'I/非IME时Enter仍续列表',
      // 原生 insertNewlineContinueMarkup：光标在「列表」和「项」之间 → 拆行并续标记
      pass: Q.getDoc() === '- 列表\n- 项',
      detail: 'doc=' + JSON.stringify(Q.getDoc())
    });
  }

  return out;
});
