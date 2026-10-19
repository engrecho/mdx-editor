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
const SB_KEY = "mdx.sidebar";

/* 多标签：每个 tab 存一份内容 + 光标 + 滚动位置 */
let tabs = [];
let activeId = null;
let tabSeq = 0;

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
    // 同步到tab 并刷新侧边栏脏标记（节流，避免每次按键都重排 DOM）
    scheduleSidebarSync();
  }
  if (u.selectionSet || u.docChanged) updateStatus();
}

// 侧边栏脏标记刷新：250ms 内合并多次按键
let sbSyncTimer = null;
function scheduleSidebarSync() {
  if (sbSyncTimer) return;
  sbSyncTimer = setTimeout(() => {
    sbSyncTimer = null;
    const t = activeTab();
    if (t) { t.dirty = true; t.content = view.state.doc.toString(); }
    renderSidebar();
  }, 250);
}

// 记录光标与滚动位置，供切回时恢复
let lastSaveCursor = 0;
setInterval(() => {
  const t = activeTab();
  if (!t) return;
  t.sel = view.state.selection.main.head;
  try { t.scroll = view.scrollDOM.scrollTop; } catch (e) {}
}, 800);

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

/* ============ 文件操作（多标签） ============ */
function tabName(t) {
  if (t.path) return t.path.split(/[\\/]/).pop();
  return t.name || "未命名.md";
}

function activeTab() {
  return tabs.find(t => t.id === activeId) || null;
}

/** 同步当前编辑器内容回 active tab */
function syncActive() {
  const t = activeTab();
  if (!t) return;
  t.content = view.state.doc.toString();
  t.dirty = dirty;
}

function addTab({ path = null, content = '', name = '' } = {}) {
  // 已打开同一路径则切过去
  if (path) {
    const exist = tabs.find(t => t.path === path);
    if (exist) { switchTab(exist.id); return exist; }
  }
  const t = { id: ++tabSeq, path, name, content, dirty: false, sel: 0, scroll: 0 };
  tabs.push(t);
  switchTab(t.id);
  return t;
}

function switchTab(id) {
  if (id === activeId) return;
  syncActive();

  const t = tabs.find(x => x.id === id);
  if (!t) return;
  activeId = id;
  dirty = false;

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: t.content || "" },
    selection: { anchor: Math.min(t.sel || 0, (t.content || "").length) },
    scrollIntoView: false
  });
  // 恢复滚动位置
  requestAnimationFrame(() => {
    try { view.scrollDOM.scrollTop = t.scroll || 0; } catch (e) {}
  });

  currentPath = t.path;
  fileName.textContent = tabName(t);
  setDirty(t.dirty);
  renderSidebar();
  renderPreview();
  updateStatus();
}

async function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const t = tabs[idx];

  if (t.dirty) {
    const r = window.confirm(`「${tabName(t)}」有未保存的修改。\n\n点「确定」保存，点「取消」放弃关闭，点「取消」也可选择不关闭。`);
    // confirm 只有两态，这里用两次确认区分
    if (r) {
      const saved = await saveTab(t);
      if (!saved) return;   // 取消保存对话框则不关闭
    } else {
      const again = window.confirm(`确定放弃「${tabName(t)}」的修改吗？此操作不可恢复。`);
      if (!again) return;
    }
  }

  tabs.splice(idx, 1);
  if (activeId === id) {
    activeId = null;
    if (tabs.length) {
      // 打开相邻的：优先右侧，其次左侧
      const next = tabs[idx] || tabs[idx - 1];
      if (next) switchTab(next.id);
    } else {
      addTab();   // 全部关掉后留一个空文档
    }
  } else {
    renderSidebar();
  }
  persistSession();
}

async function closeAllTabs() {
  const dirtyTabs = tabs.filter(t => t.dirty);
  if (dirtyTabs.length) {
    const ok = window.confirm(`${dirtyTabs.length} 个文档有未保存的修改，全部关闭将丢失这些修改。\n\n确定继续吗？`);
    if (!ok) return;
  }
  tabs = [];
  activeId = null;
  addTab();
  persistSession();
}

async function newFile() {
  addTab();
  view.focus();
  toast("已新建文档");
}

async function openFile() {
  const r = await window.api.open();
  if (!r) return;
  if (r.error) { toast("打开失败：" + r.error); return; }
  addTab({ path: r.path, content: r.content || '' });
  toast("已打开 " + tabName(tabs.find(t => t.id === activeId) || {}));
}

/** 保存指定 tab（可指定是否另存为）；返回是否成功 */
async function saveTab(t, saveAs = false) {
  const content = t.id === activeId ? view.state.doc.toString() : t.content;
  if (saveAs || !t.path) {
    const r = await window.api.saveAs(content, tabName(t));
    if (!r) return false;
    t.path = r.path;
    t.name = '';
  } else {
    await window.api.save(t.path, content);
  }
  t.content = content;
  t.dirty = false;
  if (t.id === activeId) { setDirty(false); fileName.textContent = tabName(t); }
  renderSidebar();
  window.api.rebuildMenu();
  persistSession();
  return true;
}

async function saveFile(saveAs) {
  syncActive();
  const t = activeTab();
  if (!t) return;
  const ok = await saveTab(t, saveAs);
  if (ok) toast("已保存");
}

/* ============ 会话持久化（多标签崩溃恢复） ============ */
const SESSION_KEY = "mdx.session";

function saveDraft() {
  try {
    syncActive();
    // 已保存的文档不存内容（从磁盘读），只存路径，减小体积
    const list = tabs.map(t => ({
      path: t.path,
      name: t.name,
      dirty: t.dirty,
      content: t.dirty ? t.content : null
    }));
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      v: 1,
      activePath: (activeTab() && activeTab().path) || null,
      list: list
    }));
  } catch (e) {
    // 容量超限时兜底：只存未保存的内容
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        v: 1,
        list: tabs.filter(t => t.dirty).map(t => ({ path: t.path, name: t.name, dirty: true, content: t.content }))
      }));
    } catch (e2) {}
  }
}

/** 恢复上次会话：已保存的从磁盘重读，未保存的用暂存内容 */
async function loadDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
  if (!d || !d.list || !d.list.length) return false;

  const restored = [];
  for (const it of d.list) {
    let content = it.content;
    if (!content && it.path) {
      try {
        const r = await window.api.openPath(it.path);
        if (r && !r.error) content = r.content || "";
        else continue;
      } catch (e) { continue; }
    }
    if (content == null) content = "";
    restored.push({ path: it.path, name: it.name, content: content, dirty: !!it.dirty });
  }
  if (!restored.length) return false;

  for (const r of restored) addTab(r);
  const target = tabs.find(t => t.path === d.activePath);
  if (target) switchTab(target.id);
  return true;
}

function clearDraft() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }
function persistSession() { saveDraft(); }

/* ============ 侧边栏折叠 ============ */
function setSidebar(collapsed) {
  const ws = document.querySelector(".workspace");
  if (!ws) return;
  ws.dataset.sb = collapsed ? "collapsed" : "open";
  try { localStorage.setItem(SB_KEY, collapsed ? "collapsed" : "open"); } catch (e) {}
  const u = document.querySelector("#btnPanel use");
  if (u) u.setAttribute("href", collapsed ? "#i-panel-close" : "#i-panel");
  requestAnimationFrame(() => { view.requestMeasure(); renderPreview(); });
}
function toggleSidebar() {
  const ws = document.querySelector(".workspace");
  setSidebar(ws.dataset.sb !== "collapsed");
}

/* ============ 侧边栏渲染 ============ */
const sbList = document.getElementById("sbList");
const sbCount = document.getElementById("sbCount");

function renderSidebar() {
  if (!sbList) return;
  sbCount.textContent = tabs.length;
  if (!tabs.length) {
    const e = document.createElement("div");
    e.className = "sb-empty";
    e.textContent = "没有打开的文档";
    sbList.replaceChildren(e);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const t of tabs) {
    const el = document.createElement("div");
    el.className = "sb-item" + (t.id === activeId ? " active" : "");
    el.dataset.id = t.id;
    el.title = t.path || "（未保存）";

    const ico = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-doc");
    ico.appendChild(use);

    const name = document.createElement("span");
    name.className = "sb-name";
    name.textContent = tabName(t);
    if (t.dirty) {
      const dot = document.createElement("i");
      dot.className = "sb-dot";
      name.appendChild(dot);
    }

    const close = document.createElement("button");
    close.className = "sb-close";
    close.title = "关闭（中间键）";
    close.innerHTML = '<svg><use href="#i-x"/></svg>';
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(t.id);
    });

    el.addEventListener("click", () => switchTab(t.id));
    el.addEventListener("auxclick", (e) => { if (e.button === 1) closeTab(t.id); });

    el.append(ico, name, close);
    frag.appendChild(el);
  }
  sbList.replaceChildren(frag);
  const act = sbList.querySelector(".sb-item.active");
  if (act) act.scrollIntoView({ block: "nearest" });
}

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
document.getElementById("btnPanel").addEventListener("click", toggleSidebar);
document.getElementById("btnCollapse").addEventListener("click", toggleSidebar);
document.getElementById("sbNew").addEventListener("click", () => newFile());
document.getElementById("sbOpen").addEventListener("click", () => openFile());
document.getElementById("sbCloseAll").addEventListener("click", () => closeAllTabs());

/* 侧边栏宽度拖拽；折叠态下双击把手展开 */
(function setupSidebarHandle() {
  const handle = document.getElementById("sbHandle");
  const ws = document.querySelector(".workspace");
  let dragging = false, startX = 0, startW = 0;

  handle.addEventListener("mousedown", e => {
    if (ws.dataset.sb === "collapsed") return;
    dragging = true;
    startX = e.clientX;
    startW = parseInt(getComputedStyle(ws).getPropertyValue("--sb-w")) || 208;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  handle.addEventListener("dblclick", () => setSidebar(ws.dataset.sb !== "collapsed"));

  window.addEventListener("mousemove", e => {
    if (!dragging) return;
    const w = Math.min(420, Math.max(140, startW + (e.clientX - startX)));
    ws.style.setProperty("--sb-w", w + "px");
    view.requestMeasure();
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      const w = parseInt(getComputedStyle(ws).getPropertyValue("--sb-w"));
      if (w) localStorage.setItem("mdx.sbWidth", String(w));
    } catch (e) {}
    renderPreview();
  });
})();

/* 全局快捷键：侧边栏折叠、标签切换、关闭 */
window.addEventListener("keydown", e => {
  const mod = e.ctrlKey || e.metaKey;

  // Ctrl+B 折叠侧边栏
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
    // 如果有选区，优先给加粗
    const sel = view.state.selection.main;
    if (sel.empty) { e.preventDefault(); toggleSidebar(); return; }
  }

  // Ctrl+W 关闭当前标签
  if (mod && e.key.toLowerCase() === "w" && activeId != null) {
    e.preventDefault();
    closeTab(activeId);
    return;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab 切换标签
  if (mod && e.key === "Tab") {
    e.preventDefault();
    if (tabs.length < 2) return;
    const i = tabs.findIndex(t => t.id === activeId);
    const next = e.shiftKey
      ? (i - 1 + tabs.length) % tabs.length
      : (i + 1) % tabs.length;
    switchTab(tabs[next].id);
    return;
  }

  // Ctrl+1..9 直接跳到第 N 个标签
  if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    if (idx < tabs.length) { e.preventDefault(); switchTab(tabs[idx].id); }
  }
});

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
  const r = await window.api.openPath(p);
  if (r && !r.error) addTab({ path: r.path, content: r.content || '' });
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

/* ============ 启动 ============ */
async function boot() {
  setTheme(localStorage.getItem(THEME_KEY) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  setMode(localStorage.getItem('mdx.mode') || 'split');

  // 侧边栏折叠状态与宽度
  try {
    const w = localStorage.getItem('mdx.sbWidth');
    if (w) document.querySelector('.workspace').style.setProperty('--sb-w', w + 'px');
  } catch (e) {}
  setSidebar(localStorage.getItem(SB_KEY) === 'collapsed');

  // 恢复上次会话；没有则新建一个空白文档
  const restored = await loadDraft();
  if (!restored) addTab({ content: DEFAULT_DOC });

  renderSidebar();
  renderPreview();
  updateStatus();
  view.focus();
}

// designPreview 需在 boot 完成后执行，否则两者会互相覆盖 tab 状态
const booted = boot();

/* 设计走查用：?shot=1&theme=light|dark 注入多标签演示数据并置顶主题 */
(async function designPreview() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.get('shot') !== '1') return;
  await booted;   // 等 boot 完成，避免 addTab(DEFAULT_DOC) 覆盖演示数据

  setTheme(q.get('theme') === 'dark' ? 'dark' : 'light');
  if (q.get('sb') === 'collapsed') setSidebar(true);

  const seed = window.__SEED_DOC__ || '';
  // 造几个演示标签，展示侧边栏效果
  const demo = [
    { path: '/Users/jaylon/Documents/产品需求文档.md', content: seed, dirty: false },
    { path: '/Users/jaylon/Documents/周报/2026-W42.md', content: '# 2026 第 42 周周报\n\n## 本周完成\n\n- Markdown 编辑器侧边栏\n- 图标体系\n\n## 下周计划\n\n- [ ] macOS 版本验证\n- [ ] 主题定制', dirty: true },
    { path: '/Users/jaylon/Documents/读书笔记.md', content: '# 读书笔记\n\n> 好书值得反复读。\n\n## 待读\n\n- 《思考，快与慢》\n- 《原则》', dirty: false },
    { name: '未命名.md', content: '# 草稿\n\n随手记点东西的地方。', dirty: true }
  ];
  tabs = [];
  activeId = null;
  tabSeq = 0;
  for (const d of demo) addTab(d);
  if (tabs[0]) switchTab(tabs[0].id);   // 切到第一个（产品需求文档）

  const f = document.getElementById('fileName');
  if (f) f.textContent = '产品需求文档.md';
  const p = document.getElementById('stPath');
  if (p) p.textContent = '/Users/jaylon/Documents/产品需求文档.md  ·  行 1, 列 1';

  clearDraft();
  renderSidebar();
  renderPreview();
  updateStatus();
})();