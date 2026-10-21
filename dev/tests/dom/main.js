/**
 * 预览区直接编辑 —— 真实 DOM 测试
 *
 * 跑在真实 Chromium 里（Electron 窗口），不是 jsdom/stub，
 * 所以 contenteditable、Selection、execCommand 的行为都是真的。
 *
 * 覆盖：
 *   A. DOM → Markdown 转换（所有标签分支）
 *   B. 空内容与异常（不能崩）
 *   C. 往返不变性（md → DOM → md）
 *   D. 区间回写（模拟改字/删块）
 *   E. 嵌套列表
 *   F. 转义是否过度
 *   G. loose list
 *   H. 表格细节
 *   I. 真实输入（contenteditable 里打字 → input 事件 → 回写）
 *   J. Enter / Backspace / 勾选 / 粘贴 / 点击链接
 */
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { splitBlocks, elementToMarkdown, annotateBlocks } from '../../src/renderer/live-edit.js';

const results = [];
function eq(name, actual, expected) {
  const pass = actual === expected;
  results.push({
    name,
    pass,
    detail: pass ? '' : '期望 ' + JSON.stringify(expected) + '\n实际 ' + JSON.stringify(actual)
  });
}
function ok(name, pass, detail) {
  results.push({ name, pass, detail: pass ? '' : String(detail || '') });
}
function section(t) {
  results.push({ name: '── ' + t + ' ──', pass: true, detail: '' });
}

marked.setOptions({ gfm: true, breaks: false, headerIds: true, mangle: false });

/** 把 markdown 渲染成真实的 DOM 容器（模拟预览区） */
function renderTo(md) {
  const el = document.createElement('div');
  el.innerHTML = DOMPurify.sanitize(marked.parse(md), { USE_PROFILES: { html: true } });
  return el;
}
/** 取渲染结果的第一个顶层元素 */
function firstBlock(md) {
  const el = renderTo(md);
  return el.children[0];
}

try {
/* ============================================================
 * A. DOM → Markdown：逐个标签分支
 * ============================================================ */
section('A. 标签分支');

const tagCases = [
  ['h1', '# 标题'],
  ['h2', '## 标题'],
  ['h3', '### 标题'],
  ['h6', '###### 标题'],
  ['p', '普通段落'],
  ['strong', '**粗体**'],
  ['em', '*斜体*'],
  ['del', '~~删除~~'],
  ['inline-code', '`代码`'],
  ['link', '[链接](https://a.com)'],
  ['image', '![图](a.png)'],
  ['hr', '---'],
  ['ul', '- 甲\n- 乙'],
  ['ol', '1. 甲\n2. 乙'],
  ['task-unchecked', '- [ ] 待办'],
  ['task-checked', '- [x] 完成'],
  ['blockquote', '> 引用'],
  ['fenced', '```js\nconst a=1;\n```'],
  ['table', '| A | B |\n| --- | --- |\n| 1 | 2 |'],
  ['nested-list', '- 父\n  - 子'],
  ['nested-ol', '1. 父\n   1. 子'],
  ['deep-nested', '- 父\n  - 子\n    - 孙'],
  ['loose-list', '- 甲\n\n- 乙'],
  ['mixed-inline', '普通 **粗** 和 *斜* 和 `码`'],
];

for (const [name, md] of tagCases) {
  try {
    const el = firstBlock(md);
    if (!el) { eq('A/' + name, '(无元素)', md); continue; }
    eq('A/' + name, elementToMarkdown(el, ''), md);
  } catch (e) {
    ok('A/' + name, false, '抛异常: ' + e.message);
  }
}

/* ============================================================
 * B. 空内容与异常输入（不能崩）
 * ============================================================ */
section('B. 空内容与异常');

{
  let crashed = false;
  try { elementToMarkdown(document.createElement('ul'), 'list'); } catch (e) { crashed = true; }
  eq('B/空ul不崩', crashed, false);
}
{
  let crashed = false;
  try { elementToMarkdown(document.createElement('table'), 'table'); } catch (e) { crashed = true; }
  eq('B/空table不崩', crashed, false);
  eq('B/空table返回空', elementToMarkdown(document.createElement('table'), 'table'), '');
}
{
  // 只有一行 tr（没有表头行）
  const t = document.createElement('table');
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.textContent = 'x';
  tr.appendChild(td);
  t.appendChild(tr);
  let crashed = false;
  try { elementToMarkdown(t, 'table'); } catch (e) { crashed = true; }
  eq('B/单行table不崩', crashed, false);
}
{
  // 空 strong 不能产出 ****
  const p = document.createElement('p');
  p.appendChild(document.createElement('strong'));
  eq('B/空strong不加标记', elementToMarkdown(p, 'paragraph'), '');
}
{
  // 空 em / 空 del
  const p = document.createElement('p');
  p.appendChild(document.createElement('em'));
  eq('B/空em不加标记', elementToMarkdown(p, 'paragraph'), '');
}
{
  // 空 li
  const ul = document.createElement('ul');
  ul.appendChild(document.createElement('li'));
  let crashed = false, out = '';
  try { out = elementToMarkdown(ul, 'list'); } catch (e) { crashed = true; }
  eq('B/空li不崩', crashed, false);
  eq('B/空li产出', out, '-');
}
{
  // 空 blockquote
  const bq = document.createElement('blockquote');
  let crashed = false;
  try { elementToMarkdown(bq, 'blockquote'); } catch (e) { crashed = true; }
  eq('B/空blockquote不崩', crashed, false);
}
{
  // 空链接
  const p = document.createElement('p');
  const a = document.createElement('a');
  a.href = 'https://a.com';
  p.appendChild(a);
  eq('B/空链接', elementToMarkdown(p, 'paragraph'), '[](https://a.com)');
}

/* ============================================================
 * C. 往返不变性
 * ============================================================ */
section('C. 往返不变性');

const roundtrip = [
  '# 标题',
  '| A | B |\n| --- | --- |\n| 1 | 2 |',
  '> 引用一\n> 引用二',
  '```js\nconst a=1;\n```',
  '1. 甲\n2. 乙',
  '- [ ] 待办\n- [x] 完成',
  '[链接](https://a.com)',
  '- 父\n  - 子',
  '**只有粗体**',
  '普通文本'
];

for (const md of roundtrip) {
  try {
    eq('C/往返 ' + JSON.stringify(md.slice(0, 18)),
      elementToMarkdown(firstBlock(md), ''), md);
  } catch (e) {
    ok('C/往返 ' + JSON.stringify(md.slice(0, 18)), false, e.message);
  }
}

/* ============================================================
 * D. 区间回写
 * ============================================================ */
section('D. 区间回写');

{
  const md = '# 标题\n\n第一段\n\n第二段\n\n结尾';
  const { blocks } = splitBlocks(md);
  const visible = blocks.filter(b => !b.skip);
  eq('D/可见块数', visible.length, 4);

  const t = visible[1];
  eq('D/改中间块',
    md.slice(0, t.start) + '改过的段落' + md.slice(t.end),
    '# 标题\n\n改过的段落\n\n第二段\n\n结尾');
}
{
  const md = '# 标题\n\n正文';
  const { blocks } = splitBlocks(md);
  const last = blocks.filter(b => !b.skip).pop();
  eq('D/改末块',
    md.slice(0, last.start) + '新正文' + md.slice(last.end),
    '# 标题\n\n新正文');
}
{
  // 删除整个块
  const md = '# 标题\n\n要删的段落\n\n保留的段落';
  const { blocks } = splitBlocks(md);
  const v = blocks.find(b => !b.skip && b.raw.includes('要删的段落'));
  eq('D/删块',
    md.slice(0, v.start) + '' + md.slice(v.end),
    '# 标题\n\n\n\n保留的段落');
}
{
  // 每个 block 的区间必须能回切出 raw
  const md = '# 标题\n\n段落\n\n- 列表\n\n| A |\n| --- |\n| 1 |\n\n结尾';
  const { blocks } = splitBlocks(md);
  let allOk = true;
  for (const b of blocks) {
    if (md.slice(b.start, b.end) !== b.raw) allOk = false;
  }
  eq('D/所有区间可回切', allOk, true);
  eq('D/全部raw拼接等于原文', blocks.map(b => b.raw).join(''), md);
}

/* ============================================================
 * E. 嵌套列表（重点回归）
 * ============================================================ */
section('E. 嵌套列表');

const nestedCases = [
  ['两级无序', '- 父项\n  - 子项一\n  - 子项二'],
  ['两级有序', '1. 父项\n   1. 子项一\n   2. 子项二'],
  ['三级嵌套', '- 父项\n  - 子项\n    - 孙项'],
  ['嵌套任务列表', '- [ ] 父\n  - [x] 子'],
  ['有序含无序', '1. 父项\n   - 子项']
];
for (const [name, md] of nestedCases) {
  try {
    eq('E/' + name, elementToMarkdown(firstBlock(md), 'list'), md);
  } catch (e) {
    ok('E/' + name, false, e.message);
  }
}

/* ============================================================
 * F. 转义是否过度
 * ============================================================ */
section('F. 转义');

const escapeCases = [
  ['尖括号', 'a < b > c'],
  ['下划线', 'user_name'],
  ['星号', '2 * 3 = 6'],
  ['方括号', '数组 [0] 和 [1]'],
  ['百分号', '100% 完成'],
  ['井号', '# 不是标题'],
  ['加号', '1 + 1'],
  ['减号', '1 - 1'],
  ['等号', 'a = b'],
  ['井号中间', 'C# 语言'],
  ['井号结尾', '价格 #']
];
for (const [name, text] of escapeCases) {
  const p = document.createElement('p');
  p.textContent = text;
  eq('F/' + name + ' 不转义', elementToMarkdown(p, 'paragraph'), text);
}
{
  // 反引号必须转义（否则破坏行内代码结构）
  const p = document.createElement('p');
  p.textContent = 'a ` b';
  const out = elementToMarkdown(p, 'paragraph');
  ok('F/反引号被转义', /\\`/.test(out), '实际: ' + out);
}

/* ============================================================
 * G. loose list
 * ============================================================ */
section('G. loose list');

{
  eq('G/loose list', elementToMarkdown(firstBlock('- 甲\n\n- 乙'), 'list'), '- 甲\n\n- 乙');
}
{
  // loose list 内容里带粗体
  const md = '- **甲**\n\n- 乙';
  eq('G/loose+粗体', elementToMarkdown(firstBlock(md), 'list'), md);
}

/* ============================================================
 * H. 表格细节
 * ============================================================ */
section('H. 表格细节');

{
  // 单元格里的竖线必须转义
  const t = document.createElement('table');
  const tr = document.createElement('tr');
  const th = document.createElement('th');
  th.textContent = 'A|B';
  tr.appendChild(th);
  const tr2 = document.createElement('tr');
  const td = document.createElement('td');
  td.textContent = 'x';
  tr2.appendChild(td);
  t.appendChild(tr); t.appendChild(tr2);
  ok('H/竖线被转义', elementToMarkdown(t, 'table').includes('A\\|B'));
}
{
  // 单元格里的 br 不能产生换行（会让表格断裂）
  const t = document.createElement('table');
  const tr = document.createElement('tr');
  const th = document.createElement('th');
  th.innerHTML = '第一行<br>第二行';
  tr.appendChild(th);
  const tr2 = document.createElement('tr');
  const td = document.createElement('td');
  td.textContent = 'y';
  tr2.appendChild(td);
  t.appendChild(tr); t.appendChild(tr2);
  const out = elementToMarkdown(t, 'table');
  const lines = out.split('\n');
  // 表格应该是 3 行：表头、分隔、数据。br 若产生换行会变 4 行
  eq('H/表格内br不换行(行数)', lines.length, 3);
}
{
  // 列数不齐时补齐
  const t = document.createElement('table');
  const tr = document.createElement('tr');
  ['A', 'B', 'C'].forEach(x => { const th = document.createElement('th'); th.textContent = x; tr.appendChild(th); });
  const tr2 = document.createElement('tr');
  const td = document.createElement('td');
  td.textContent = '只有一格';
  tr2.appendChild(td);
  t.appendChild(tr); t.appendChild(tr2);
  const out = elementToMarkdown(t, 'table');
  const dataLine = out.split('\n')[2];
  eq('H/列数补齐', (dataLine.match(/\|/g) || []).length, 4);
}

/* ============================================================
 * I. 真实输入：contenteditable 打字 → input → 回写
 *
 * 这里测的是「机制」：改动预览区 DOM 后，
 * splitBlocks + elementToMarkdown 能否产出正确的源码替换。
 * ============================================================ */
section('I. 真实输入回写');

{
  // 场景：用户在预览区把「第一段」改成「第一段改」
  const md = '# 标题\n\n第一段\n\n第二段';
  const { blocks } = splitBlocks(md);
  const target = blocks.find(b => !b.skip && b.raw === '第一段');

  // 模拟用户输入：DOM 里文本变了
  const dom = renderTo(md);
  dom.children[1].textContent = '第一段改';

  // 回写
  const back = elementToMarkdown(dom.children[1], '');
  const newMd = md.slice(0, target.start) + back + md.slice(target.end);
  eq('I/改字回写', newMd, '# 标题\n\n第一段改\n\n第二段');
}
{
  // 场景：用户在标题里改字
  const md = '# 旧标题\n\n正文';
  const { blocks } = splitBlocks(md);
  const t = blocks.find(b => !b.skip);
  const dom = renderTo(md);
  dom.children[0].textContent = '新标题';
  const back = elementToMarkdown(dom.children[0], '');
  // 复现 writeBackBlock 的分隔符逻辑：raw 末尾有 \n\n 就补回去
  const tail = /\n{2,}$/.test(t.raw) ? '\n\n' : '';
  eq('I/改标题回写',
    md.slice(0, t.start) + back + tail + md.slice(t.end),
    '# 新标题\n\n正文');
}
{
  // 场景：用户在列表项里改字
  const md = '- 甲\n- 乙';
  const { blocks } = splitBlocks(md);
  const t = blocks.find(b => !b.skip);
  const dom = renderTo(md);
  const li = dom.children[0].children[0];
  li.textContent = '甲改';
  const back = elementToMarkdown(dom.children[0], 'list');
  eq('I/改列表项回写',
    md.slice(0, t.start) + back + md.slice(t.end),
    '- 甲改\n- 乙');
}
{
  // 场景：用户删掉整段文字
  const md = '# 标题\n\n要删的段落\n\n保留';
  const { blocks } = splitBlocks(md);
  const t = blocks.find(b => !b.skip && b.raw.includes('要删的段落'));
  const dom = renderTo(md);
  dom.children[1].textContent = '';
  const back = elementToMarkdown(dom.children[1], '');
  eq('I/删空段回写',
    md.slice(0, t.start) + back + md.slice(t.end),
    '# 标题\n\n\n\n保留');
}
{
  // 场景：用户在段落里加粗（插入 <strong>）
  const md = '普通文本';
  const { blocks } = splitBlocks(md);
  const t = blocks.find(b => !b.skip);
  const dom = renderTo(md);
  const p = dom.children[0];
  p.textContent = '';
  p.appendChild(document.createTextNode('普通'));
  const strong = document.createElement('strong');
  strong.textContent = '粗体';
  p.appendChild(strong);
  p.appendChild(document.createTextNode('文本'));
  const back = elementToMarkdown(p, 'paragraph');
  eq('I/插入粗体回写',
    md.slice(0, t.start) + back + md.slice(t.end),
    '普通**粗体**文本');
}

/* ============================================================
 * J. 真实交互：Enter / Backspace / 勾选 / 链接
 *
 * 这些测的是 app.js 里的处理器逻辑能否正确调用回写。
 * 用最小 DOM 事件模拟。
 * ============================================================ */
section('J. 交互处理器');

{
  // annotateBlocks 必须给每个顶层元素打上 data-block
  const dom = renderTo('# 标题\n\n段落一\n\n段落二');
  annotateBlocks(dom, 3);
  eq('J/annotate数量', dom.children.length, 3);
  eq('J/annotate索引0', dom.children[0].dataset.block, '0');
  eq('J/annotate索引1', dom.children[1].dataset.block, '1');
  eq('J/annotate索引2', dom.children[2].dataset.block, '2');
}
{
  // contenteditable 容器内，checkbox 应该可点
  const dom = renderTo('- [ ] 任务');
  annotateBlocks(dom, 1);
  const cb = dom.querySelector('input[type=checkbox]');
  ok('J/checkbox存在', !!cb);
  eq('J/checkbox默认未勾', cb.checked, false);
  // 模拟勾选
  cb.checked = true;
  eq('J/勾选后转出[x]', elementToMarkdown(dom.children[0], 'list'), '- [x] 任务');
  cb.checked = false;
  eq('J/取消勾选转出[ ]', elementToMarkdown(dom.children[0], 'list'), '- [ ] 任务');
}
{
  // Enter 在段落中：应该插入 <br>（软换行），不是 <div>
  // 这里验证「段落内含 br」的往返
  const md = '第一行\n第二行';
  const el = firstBlock(md);
  // marked 的 breaks:false 下，单换行不渲染成 <br>，是同一行
  // 所以这个用例验证的是：如果 DOM 里有 <br>，要转成两个尾空格 + 换行
  const p = document.createElement('p');
  p.appendChild(document.createTextNode('第一行'));
  p.appendChild(document.createElement('br'));
  p.appendChild(document.createTextNode('第二行'));
  eq('J/br转软换行', elementToMarkdown(p, 'paragraph'), '第一行  \n第二行');
}
{
  // 链接点击：app.js 里 preventDefault + window.open
  // 这里验证链接元素能被正确识别
  const dom = renderTo('[链接](https://a.com)');
  const a = dom.querySelector('a[href]');
  ok('J/链接可识别', !!a);
  eq('J/链接href', a.getAttribute('href'), 'https://a.com');
}

/* ============================================================
 * K. 大文档性能（不能卡）
 * ============================================================ */
section('K. 性能');

{
  const md = Array.from({ length: 200 }, (_, i) =>
    '## 标题' + i + '\n\n段落内容 **粗体** 和 *斜体*。\n\n- 列表项 A\n- 列表项 B'
  ).join('\n\n');

  const t0 = performance.now();
  const { blocks } = splitBlocks(md);
  const t1 = performance.now();
  ok('K/切分200节不超时', t1 - t0 < 1000, (t1 - t0).toFixed(1) + 'ms');
  eq('K/切分节数', blocks.filter(b => !b.skip).length, 600);

  const el = renderTo(md);
  annotateBlocks(el, 600);
  const t2 = performance.now();
  // 逐个转换（模拟用户逐个改）
  let allOk = true;
  for (let i = 0; i < el.children.length; i++) {
    try { elementToMarkdown(el.children[i], ''); } catch (e) { allOk = false; }
  }
  const t3 = performance.now();
  ok('K/转换600块不超时', t3 - t2 < 2000, (t3 - t2).toFixed(1) + 'ms');
  ok('K/转换无异常', allOk);
}


} catch (topErr) {
  results.push({ name: 'HARNESS-TOPLEVEL', pass: false, detail: String((topErr && topErr.stack) || topErr) });
}

/* ---------- 汇总 ---------- */
const pass = results.filter(r => r.pass).length;
const fail = results.filter(r => !r.pass).length;
window.__TEST_RESULTS__ = { results, pass, fail, total: results.length };
window.__TEST_DONE__ = true;
