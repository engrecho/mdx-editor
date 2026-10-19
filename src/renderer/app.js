import { EditorView, keymap, lineNumbers, highlightActiveLineGutter,
         drawSelection, dropCursor } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const DEFAULT_DOC = `# 欢迎使用轻墨

**轻墨** 是一个简洁轻量的 Markdown 编辑器。左边写，右边即时看到成品。

## 快速上手

| 想做什么 | 怎么做 |
| --- | --- |
| 保存 | Ctrl+S |
| 插入表格 | Ctrl+T |
| 插入引用 | Ctrl+Shift+Q |
| 切换视图 | Ctrl+1 / 2 / 3 |
| 深色模式 | Ctrl+D |

## 表格

选中若干行再按 Ctrl+T，首行自动作表头：

| 功能 | 快捷键 | 说明 |
| --- | --- | --- |
| 加粗 | Ctrl+B | 选中文字后按，再次按下取消 |
| 插入表格 | Ctrl+T | 无选区时插入空白表格 |
| 导出 HTML | Ctrl+Shift+E | 生成带样式的独立网页 |

## 代码

\`\`\`js
function hello(name) {
  return \`你好，\${name}\`;
}
\`\`\`

## 引用

> 好工具应该让人忘记它的存在。
> 你只管写，格式交给它。

- [x] 实时预览
- [x] 快捷插入表格 / 引用 / 列表
- [x] 深色模式
- [ ] 自定义主题（计划中）

---

*试试拖动中间的分隔线，或按 Ctrl+3 只看预览。*
`;

/* ============ Editor 初始化 ============ */
const editorTheme = EditorView.theme({
  "&": { color: "var(--fg)", backgroundColor: "var(--bg)", height: "100%" },
  ".cm-content": { caretColor: "var(--accent)", padding: "14px 0" },
  ".cm-line": { padding: "0 16px" }
});

const syntaxTheme = EditorView.theme({
  ".cm-header": { color: "var(--accent)", fontWeight: "700" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-emphasis": { fontStyle: "italic" },
  ".cm-strikethrough": { textDecoration: "line-through", color: "var(--fg-faint)" },
  ".cm-monospace": { color: "#7c5cff" },
  ".cm-url": { color: "var(--fg-faint)" },
  ".cm-comment": { color: "var(--fg-faint)", fontStyle: "italic" },
  ".cm-list": { color: "var(--accent)" },
  ".cm-quote": { color: "var(--fg-dim)", fontStyle: "italic" },
  ".cm-hr": { color: "var(--fg-faint)" },
  ".cm-meta": { color: "var(--fg-faint)" },
  ".cm-formatting": { color: "var(--fg-faint)" },
  ".cm-formatting-link": { color: "var(--fg-faint)" },
  ".cm-formatting-list": { color: "var(--accent)" },
  ".cm-tag": { color: "var(--accent)" },
  ".cm-atom": { color: "var(--accent)" },
  ".cm-variable": { color: "#d4506a" }
});

const state = EditorState.create({
  doc: DEFAULT_DOC,
  extensions: [
    lineNumbers(), highlightActiveLineGutter(), history(),
    drawSelection(), dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentUnit.of("  "),
    closeBrackets(),
    syntaxHighlighting(HighlightStyle.define([
      { tag: t.heading1, color: "var(--accent)", fontWeight: "700", fontSize: "1.35em" },
      { tag: t.heading2, color: "var(--accent)", fontWeight: "700", fontSize: "1.2em" },
      { tag: t.heading3, color: "var(--accent)", fontWeight: "700" },
      { tag: [t.heading4, t.heading5, t.heading6], color: "var(--accent)", fontWeight: "600" },
      { tag: t.strong, fontWeight: "700", color: "var(--fg)" },
      { tag: t.emphasis, fontStyle: "italic" },
      { tag: t.strikethrough, textDecoration: "line-through", color: "var(--fg-faint)" },
      { tag: t.monospace, color: "#7c5cff" },
      { tag: t.link, color: "var(--accent)" },
      { tag: t.url, color: "var(--fg-faint)" },
      { tag: t.quote, color: "var(--fg-dim)", fontStyle: "italic" },
      { tag: t.list, color: "var(--accent)" },
      { tag: t.processingInstruction, color: "var(--fg-faint)" },
      { tag: t.meta, color: "var(--fg-faint)" },
      { tag: t.comment, color: "var(--fg-faint)", fontStyle: "italic" },
      { tag: t.contentSeparator, color: "var(--fg-faint)" },
      { tag: t.labelName, color: "var(--accent)" },
      { tag: t.keyword, color: "#d4506a" },
      { tag: t.string, color: "#2ea043" }
    ])),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    keymap.of([
      { key: "Tab", run: (v) => indentMore(v) || indentLess(v) },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
      ...formattingKeymap()
    ]),
    editorTheme, syntaxTheme,
    EditorView.updateListener.of(onUpdate),
    EditorView.lineWrapping
  ]
});

const view = new EditorView({ state, parent: document.getElementById("editor") });
window.__view = view;

/* ============ 状态 ============ */
let currentPath = null;
let dirty = false;
let renderTimer = null;
const DRAFT_KEY = "mdx.draft";
const THEME_KEY = "mdx.theme";

/* ============ 渲染预览 ============ */
const previewEl = document.getElementById("preview");

marked.setOptions({ gfm: true, breaks: false, headerIds: true, mangle: false });

function renderPreview() {
  const md = view.state.doc.toString();
  try {
    const raw = marked.parse(md);
    previewEl.innerHTML = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
    previewEl.querySelectorAll("input[type=checkbox]").forEach(cb => { cb.disabled = true; });
  } catch (e) {
    previewEl.innerHTML = '<p style="color:#d4506a">预览渲染出错：' + e.message + '</p>';
  }
  updateStatus();
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 80);
}

function onUpdate(u) {
  if (u.docChanged) {
    dirty = true;
    setDirty(true);
    scheduleRender();
    saveDraft();
  }
  if (u.selectionSet || u.docChanged) updateStatus();
}

/* ============ 状态栏 ============ */
const stPath = document.getElementById("stPath");
const stSaved = document.getElementById("stSaved");
const stWords = document.getElementById("stWords");
const stLines = document.getElementById("stLines");
const fileName = document.getElementById("fileName");

function setDirty(v) {
  dirty = v;
  stSaved.textContent = v ? "未保存" : "已保存";
  stSaved.classList.toggle("dirty", v);
}

function updateStatus() {
  const doc = view.state.doc;
  const text = doc.toString();
  const lines = doc.lines;
  const chars = text.replace(/\s/g, "").length;
  stWords.textContent = chars + " 字";
  stLines.textContent = lines + " 行";
  const pos = view.state.selection.main.head;
  const line = doc.lineAt(pos);
  stPath.textContent = `${currentPath || "未命名"}  ·  行 ${line.number}, 列 ${pos - line.from + 1}`;
}

/* ============ 文件操作 ============ */
async function newFile() {
  if (dirty && !(await confirmDiscard())) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
  currentPath = null;
  fileName.textContent = "未命名.md";
  setDirty(false);
  view.focus();
  toast("已新建文档");
}

async function confirmDiscard() {
  return window.confirm("当前文档有未保存的修改，确定放弃吗？");
}

async function openFile() {
  if (dirty && !(await confirmDiscard())) return;
  const r = await window.api.open();
  if (!r) return;
  if (r.error) { toast("打开失败：" + r.error); return; }
  loadDoc(r.content, r.path);
}

function loadDoc(content, p) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content || "" } });
  currentPath = p || null;
  fileName.textContent = currentPath ? currentPath.split(/[\\/]/).pop() : "未命名.md";
  stPath.textContent = currentPath || "未命名";
  setDirty(false);
  clearDraft();
  renderPreview();
  view.focus();
}

async function saveFile(saveAs) {
  const content = view.state.doc.toString();
  if (saveAs || !currentPath) {
    const r = await window.api.saveAs(content, currentPath ? currentPath.split(/[\\/]/).pop() : "未命名.md");
    if (!r) return;
    currentPath = r.path;
  } else {
    await window.api.save(currentPath, content);
  }
  fileName.textContent = currentPath.split(/[\\/]/).pop();
  setDirty(false);
  window.api.rebuildMenu();
  toast("已保存");
}

/* ============ 草稿（崩溃恢复） ============ */
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      content: view.state.doc.toString(),
      path: currentPath
    }));
  } catch (e) {}
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (d && d.content) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: d.content } });
      if (d.path) { currentPath = d.path; fileName.textContent = d.path.split(/[\\/]/).pop(); }
      setDirty(true);
    }
  } catch (e) {}
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} }

/* ============ 插入 / 格式化 ============ */
function getSel() {
  const r = view.state.selection.main;
  return { from: r.from, to: r.to, text: view.state.sliceDoc(r.from, r.to) };
}

function replaceSelection(text, selectOffset) {
  const { from, to } = getSel();
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + (selectOffset != null ? selectOffset : text.length) }
  });
  view.focus();
}

function wrap(before, after) {
  const { from, to, text } = getSel();
  if (!text) {
    replaceSelection(before + after, before.length);
    return;
  }
  // 已包裹则取消包裹
  const beforeText = view.state.sliceDoc(Math.max(0, from - before.length), from);
  const afterText = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + after.length));
  if (beforeText === before && afterText === after) {
    view.dispatch({
      changes: [
        { from: from - before.length, to, insert: text },
        { from: from - before.length + text.length, to: to + after.length }
      ],
      selection: { anchor: from - before.length, head: from - before.length + text.length }
    });
    view.focus();
    return;
  }
  replaceSelection(before + text + after, before.length + text.length);
  view.dispatch({ selection: { anchor: from + before.length, head: from + before.length + text.length } });
}

// 块级插入：智能处理行首
function insertBlock(text, cursorOffsetInBlock) {
  const { from, to } = getSel();
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);
  const selText = view.state.sliceDoc(from, to);
  const body = selText || text;

  const prefix = startLine.from === 0 ? '' : '\n\n';
  const full = prefix + body + '\n';
  const pos = from + prefix.length + (cursorOffsetInBlock != null ? cursorOffsetInBlock : body.length);
  view.dispatch({
    changes: { from: startLine.from, to: endLine.to, insert: full },
    selection: { anchor: pos }
  });
  view.focus();
}

function insertTable() {
  const { from, to } = getSel();
  const hasSel = view.state.sliceDoc(from, to).length > 0;
  const tpl =
`| 表头 A | 表头 B | 表头 C |\n` +
`| --- | --- | --- |\n` +
`| 内容 1 | 内容 2 | 内容 3 |\n` +
`| 内容 4 | 内容 5 | 内容 6 |`;
  if (hasSel) {
    // 把选区当表头
    const sel = view.state.sliceDoc(from, to).split('\n').map(s => s.trim()).filter(Boolean);
    const cols = Math.max(2, sel.length);
    const head = sel.length >= cols ? sel.slice(0, cols) : Array.from({ length: cols }, (_, i) => sel[i] || `列${i + 1}`);
    const rows = sel.length > cols ? sel.slice(cols) : [];
    const t2 =
      `| ${head.join(' | ')} |\n| ${head.map(() => '---').join(' | ')} |\n` +
      (rows.length ? rows.map(r => `| ${r} | ${head.slice(1).map(() => ' ').join(' | ')} |`).join('\n') + '\n' : '|  |  |\n');
    replaceSelection(t2, 2);
  } else {
    insertBlock(tpl, null);
  }
  toast('已插入表格');
}

function insertQuote() {
  const { from, to, text } = getSel();
  if (text) {
    const q = text.split('\n').map(l => '> ' + l).join('\n');
    replaceSelection(q, q.length);
  } else {
    replaceSelection('> 引用内容\n', 2);
  }
  toast('已插入引用');
}

function insertCodeBlock() {
  const { from, to, text } = getSel();
  if (text) replaceSelection('```\n' + text + '\n```\n', 4 + text.length);
  else replaceSelection('```\n\n```', 3);
  toast('已插入代码块');
}

function insertList(kind) {
  const { from, to, text } = getSel();
  if (text) {
    const lines = text.split('\n');
    const out = lines.map((l, i) => kind === 'ol' ? `${i + 1}. ${l}` : `- ${l}`).join('\n');
    replaceSelection(out, out.length);
    return;
  }
  const tpl = kind === 'ol' ? '1. \n2. \n3. ' : '- \n- \n- ';
  replaceSelection(tpl, kind === 'ol' ? 3 : 2);
}

function insertTodo() {
  const { from, to, text } = getSel();
  if (text) {
    const out = text.split('\n').map(l => `- [ ] ${l.replace(/^[-*]\s*(\[[ xX]\]\s*)?/, '')}`).join('\n');
    replaceSelection(out, out.length);
  } else {
    replaceSelection('- [ ] 待办事项', 6);
  }
}

function insertHr() {
  replaceSelection('\n\n---\n\n', 7);
}

function insertLink() {
  const { from, to, text } = getSel();
  if (text) {
    const s = `[${text}](https://)`;
    replaceSelection(s, s.length - 1);
  } else {
    replaceSelection('[链接文字](https://)', 4);
  }
  toast('已插入链接，填入地址后按 Esc');
}

function insertImage() {
  replaceSelection('![图片描述](https://)', 7);
  toast('已插入图片语法');
}

function heading(level) {
  const { from, to, text } = getSel();
  const line = view.state.doc.lineAt(from);
  const existing = /^(#{1,6})\s/.exec(view.state.sliceDoc(line.from, line.to));
  const prefix = '#'.repeat(level) + ' ';
  if (text) {
    // 有选区：如果整行已是目标级别则降级为正文
    if (existing && existing[1].length === level) {
      view.dispatch({ changes: { from: line.from, to: line.from + existing[0].length, insert: '' } });
      view.focus(); return;
    }
    insertBlock(prefix + text, prefix.length);
  } else {
    if (existing) {
      if (existing[1].length === level) {
        view.dispatch({ changes: { from: line.from, to: line.from + existing[0].length, insert: '' } });
      } else {
        view.dispatch({ changes: { from: line.from, to: line.from + existing[0].length, insert: prefix } });
      }
    } else {
      view.dispatch({ changes: { from: line.from, insert: prefix } });
    }
    view.focus();
  }
}

function formattingKeymap() {
  return [
    { key: "Mod-b", run: () => (wrap("**", "**"), true) },
    { key: "Mod-i", run: () => (wrap("*", "*"), true) },
    { key: "Mod-e", run: () => (wrap("`", "`"), true) },
    { key: "Mod-Shift-x", run: () => (wrap("~~", "~~"), true) },
    { key: "Mod-Shift-k", run: () => (insertCodeBlock(), true) },
    { key: "Mod-Shift-q", run: () => (insertQuote(), true) },
    { key: "Mod-Alt-1", run: () => (heading(1), true) },
    { key: "Mod-Alt-2", run: () => (heading(2), true) },
    { key: "Mod-Alt-3", run: () => (heading(3), true) }
  ];
}

/* ============ 命令分发 ============ */
const COMMANDS = {
  'cmd:new': newFile,
  'cmd:open': openFile,
  'cmd:save': () => saveFile(false),
  'cmd:saveAs': () => saveFile(true),
  'cmd:exportHtml': exportHtml,
  'cmd:find': () => view.dispatch({ effects: [] }),
  'fmt:bold': () => wrap("**", "**"),
  'fmt:italic': () => wrap("*", "*"),
  'fmt:strike': () => wrap("~~", "~~"),
  'fmt:code': () => wrap("`", "`"),
  'fmt:h1': () => heading(1),
  'fmt:h2': () => heading(2),
  'fmt:h3': () => heading(3),
  'ins:table': insertTable,
  'ins:quote': insertQuote,
  'ins:code': insertCodeBlock,
  'ins:ul': () => insertList('ul'),
  'ins:ol': () => insertList('ol'),
  'ins:todo': insertTodo,
  'ins:hr': insertHr,
  'ins:link': insertLink,
  'ins:image': insertImage
};

function run(cmd) {
  const fn = COMMANDS[cmd];
  if (fn) fn();
}

function exportHtml() {
  const css = `
    :root { color-scheme: light dark }
    * { box-sizing: border-box }
    body {
      max-width: 760px; margin: 0 auto; padding: 64px 28px 96px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                   "Microsoft YaHei", sans-serif;
      font-size: 16px; line-height: 1.85; color: #1a1d23; background: #fff;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4, h5, h6 { font-weight: 650; line-height: 1.35; margin: 1.9em 0 .7em }
    h1 { font-size: 1.95em; letter-spacing: -.02em }
    h2 { font-size: 1.5em; padding-bottom: .35em; border-bottom: 1px solid #e4e7ec }
    h3 { font-size: 1.24em } h4 { font-size: 1.06em }
    p { margin: 0 0 1.15em }
    a { color: #3b6ef0; text-decoration: none; border-bottom: 1px solid #c3d4fb }
    a:hover { border-bottom-color: #3b6ef0 }
    strong { font-weight: 700 }
    code {
      font-family: "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
      font-size: .87em; padding: .18em .42em;
      background: #eef0f3; border-radius: 5px;
    }
    pre {
      margin: 1.4em 0; padding: 18px 20px; line-height: 1.7;
      background: #fafbfc; border: 1px solid #e4e7ec;
      border-radius: 10px; overflow-x: auto;
    }
    pre code { background: none; padding: 0; font-size: .86em; color: #3d4550 }
    blockquote {
      margin: 1.4em 0; padding: .7em 1.3em; color: #3d4550;
      border-left: 3px solid #3b6ef0; background: #fafbfc;
      border-radius: 0 7px 7px 0;
    }
    blockquote p:last-child { margin-bottom: 0 }
    table {
      border-collapse: separate; border-spacing: 0; width: 100%;
      margin: 1.5em 0; font-size: .94em;
      border: 1px solid #e4e7ec; border-radius: 7px; overflow: hidden;
    }
    th, td { padding: 10px 15px; border-bottom: 1px solid #e4e7ec; border-right: 1px solid #e4e7ec; text-align: left }
    th:last-child, td:last-child { border-right: none }
    tr:last-child td { border-bottom: none }
    th { background: #f5f6f8; font-weight: 600; font-size: .95em; color: #3d4550 }
    tbody tr:nth-child(even) { background: #fafbfc }
    ul, ol { padding-left: 1.5em; margin: 0 0 1.15em }
    li { margin: .35em 0 }
    li::marker { color: #9aa3af }
    li.task-list-item { list-style: none; margin-left: -1.5em }
    input[type="checkbox"] { margin-right: .55em; accent-color: #3b6ef0; vertical-align: middle }
    hr { margin: 2.6em 0; border: none; height: 1px; background: #e4e7ec }
    img { max-width: 100%; border-radius: 7px }

    @media (prefers-color-scheme: dark) {
      body { background: #16181c; color: #e9edf3 }
      h2, hr { border-color: #2b3038 }
      code { background: #23272e }
      pre { background: #191c21; border-color: #2b3038 }
      pre code { color: #c8cfd9 }
      blockquote { background: #191c21; color: #c8cfd9; border-left-color: #5b8cff }
      table, th, td { border-color: #2b3038 }
      th { background: #1d2127; color: #c8cfd9 }
      tbody tr:nth-child(even) { background: #191c21 }
      a { color: #5b8cff; border-bottom-color: #2f4470 }
      li::marker { color: #79828f }
    }`;
  const title = currentPath ? currentPath.split(/[\\/]/).pop() : 'untitled';
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${css}</style></head>
<body>${DOMPurify.sanitize(marked.parse(view.state.doc.toString()))}</body></html>`;
  window.api.exportHtml(html, title.replace(/\.md$/i, '')).then(r => {
    if (r) toast("已导出 HTML");
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ============ 视图模式 ============ */
const panes = document.getElementById("panes");
function setMode(mode) {
  panes.dataset.mode = mode;
  document.querySelectorAll('#segbar .seg').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
  localStorage.setItem('mdx.mode', mode);
  requestAnimationFrame(() => { view.requestMeasure(); if (mode !== 'preview') renderPreview(); });
}

/* ============ 主题 ============ */
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  const meta = document.querySelector('meta[name="theme-color"]') || (() => {
    const m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); return m;
  })();
  meta.content = t === 'dark' ? '#16181d' : '#ffffff';
}
function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

/* ============ Toast ============ */
const toastEl = document.getElementById("toast");
let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1600);
}

/* ============ 分隔条拖拽 ============ */
(function setupDivider() {
  const divider = document.getElementById("divider");
  let dragging = false;
  divider.addEventListener("mousedown", e => {
    dragging = true;
    divider.classList.add('dragging');
    e.preventDefault();
  });
  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    const rect = panes.getBoundingClientRect();
    let pct = ((e.clientX - rect.left) / rect.width) * 100;
    pct = Math.min(80, Math.max(20, pct));
    panes.style.setProperty('--split', pct + '%');
    view.requestMeasure();
  });
  window.addEventListener("mouseup", () => {
    if (dragging) { dragging = false; divider.classList.remove('dragging'); renderPreview(); }
  });
})();

/* ============ 事件绑定 ============ */
document.getElementById("titlebar").addEventListener("click", e => {
  const btn = e.target.closest('[data-cmd]');
  if (btn) { run(btn.dataset.cmd); return; }
  const seg = e.target.closest('[data-view]');
  if (seg) setMode(seg.dataset.view);
});
document.getElementById("btnTheme").addEventListener("click", toggleTheme);

window.api.on([
  'cmd:new', 'cmd:open', 'cmd:save', 'cmd:saveAs', 'cmd:exportHtml', 'cmd:find',
  'view:edit', 'view:split', 'view:preview', 'view:theme'
], (ch) => {
  const map = {
    'view:edit': () => setMode('edit'),
    'view:split': () => setMode('split'),
    'view:preview': () => setMode('preview'),
    'view:theme': toggleTheme
  };
  if (map[ch]) map[ch](); else run(ch);
});

window.api.on([
  'ins:table', 'ins:quote', 'ins:code', 'ins:ul', 'ins:ol', 'ins:todo', 'ins:hr', 'ins:link', 'ins:image',
  'fmt:bold', 'fmt:italic', 'fmt:code', 'fmt:strike', 'fmt:h1', 'fmt:h2', 'fmt:h3'
], (ch) => run(ch));

window.api.on('cmd:openPath', async p => {
  if (dirty && !(await confirmDiscard())) return;
  const r = await window.api.openPath(p);
  if (r && !r.error) loadDoc(r.content, r.path);
});

/* 预览区点击表格不触发任何编辑 */
previewEl.addEventListener("click", e => {
  const a = e.target.closest('a');
  if (a && /^https?:/.test(a.getAttribute('href') || '')) {
    e.preventDefault();
    window.open(a.getAttribute('href'), '_blank');
  }
});

/* 拖拽图片文件插入 */
document.getElementById("panes").addEventListener("dragover", e => e.preventDefault());
document.getElementById("panes").addEventListener("drop", e => {
  e.preventDefault();
  const f = Array.from(e.dataTransfer.files)[0];
  if (f) toast("提示：图片请用 Markdown 语法 ![](路径) 引用");
});

/* 启动 */
setTheme(localStorage.getItem(THEME_KEY) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
setMode(localStorage.getItem('mdx.mode') || 'split');
loadDraft();
renderPreview();
updateStatus();
view.focus();

/* 设计走查用：?shot=1&theme=light|dark 注入演示文档并置顶主题 */
(function designPreview() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.get('shot') !== '1') return;
  setTheme(q.get('theme') === 'dark' ? 'dark' : 'light');
  const seed = window.__SEED_DOC__;
  if (seed) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: seed } });
    setDirty(false);
    clearDraft();
  }
  const f = document.getElementById('fileName');
  if (f) f.textContent = '产品需求文档.md';
  const p = document.getElementById('stPath');
  if (p) p.textContent = '/Users/jaylon/Documents/产品需求文档.md · 行 1, 列 1';
  renderPreview();
  updateStatus();
})();