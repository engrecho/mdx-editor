#!/usr/bin/env node
/**
 * 编辑内核单元测试（纯 Node，不需要 Electron）
 *
 * 测的是 editor-core.js / editor-keys.js 里的纯计算：
 *   · Markdown 语法识别（前缀、强调区间、表格行）
 *   · Enter / Backspace / Tab 的行为规划
 *   · 块级插入的位置计算
 *
 * 这些函数不依赖 CodeMirror，所以能毫秒级跑完 ——
 * 改一行逻辑立刻能验证，不用起 Electron。
 *
 * 用法：node scripts/test-editor-core.js
 */
const path = require('path');
const fs = require('fs');
const util = require('util');

const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');
const SCRATCH = path.join(ROOT, '.cache', 'scratch');

// editor-core.js / editor-keys.js 是浏览器端的 ESM，Node 的 require 加载不了。
// 用 esbuild 打成一个 CJS 再 require（中间产物放 .cache/）。
require('esbuild').buildSync({
  stdin: {
    contents: `
      export * from ${JSON.stringify(path.join(DEV, 'src', 'renderer', 'editor-core.js'))};
      export * from ${JSON.stringify(path.join(DEV, 'src', 'renderer', 'editor-keys.js'))};
    `,
    resolveDir: DEV,
    loader: 'js'
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: path.join(SCRATCH, 'editor-core.bundle.cjs'),
  logLevel: 'silent'
});
const mod = require(path.join(SCRATCH, 'editor-core.bundle.cjs'));
const core = mod;
const keys = mod;

const results = [];
function eq(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({
    name, pass,
    detail: pass ? '' : '期望 ' + JSON.stringify(expected) + ' / 实际 ' + JSON.stringify(actual)
  });
}
function ok(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: cond ? '' : String(detail || '') });
}
function section(t) { results.push({ name: '── ' + t + ' ──', pass: true, detail: '' }); }

/* ============ A. 行前缀识别 ============ */
section('A. 行前缀识别');

eq('A/无序列表', core.parseListItem('- 内容'), { marker: '- ', rest: '内容', kind: 'ul' });
eq('A/有序列表', core.parseListItem('3. 内容'), { marker: '3. ', rest: '内容', kind: 'ol', num: 3 });
eq('A/任务未勾', core.parseListItem('- [ ] 内容'),
  { marker: '- [ ] ', rest: '内容', kind: 'todo', checked: false });
eq('A/任务已勾', core.parseListItem('- [x] 内容'),
  { marker: '- [x] ', rest: '内容', kind: 'todo', checked: true });
eq('A/嵌套列表保留缩进', core.parseListItem('  - 子项').marker, '  - ');
eq('A/普通段落不是列表', core.parseListItem('普通文字'), null);
eq('A/引用不是列表', core.parseListItem('> 引用'), null);
ok('A/列表行判定', core.isListLine('- x') && core.isListLine('1. x') && !core.isListLine('x'));

/* ============ B. 强调区间检测 ============ */
section('B. 强调区间检测');

{
  const d = '这是**加粗**的文字';
  const e = core.findEmphasisAt(d, 5);   // '粗' 位置
  ok('B/找到粗体区间', !!e, '没找到');
  eq('B/粗体起点', e && e.start, 2);
  eq('B/粗体内文起点', e && e.innerStart, 4);
  eq('B/粗体内文终点', e && e.innerEnd, 6);
  eq('B/粗体终点', e && e.end, 8);
}
{
  const d = '这是`代码`文字';
  const e = core.findEmphasisAt(d, 4);
  eq('B/行内代码区间', e && [e.start, e.innerStart, e.innerEnd, e.end], [2, 3, 5, 6]);
}
{
  const d = '这是~~删除~~文字';
  const e = core.findEmphasisAt(d, 5);
  ok('B/删除线区间', !!e, '没找到');
  eq('B/删除线标记', e && e.marker, '~~');
}
{
  // 粗体里的斜体：应该优先匹配 **（长标记优先）
  const d = '***粗斜***';
  const e = core.findEmphasisAt(d, 2);
  eq('B/嵌套优先长标记', e && e.marker, '**');
}
{
  // 不在强调里
  eq('B/普通位置无强调', core.findEmphasisAt('普通文字', 2), null);
}
{
  // 完整覆盖判定
  const d = '**加粗**';
  const cover = core.coveringEmphasis(d, 2, 4);
  ok('B/完整覆盖', !!cover, '没识别到');
  const partial = core.coveringEmphasis(d, 2, 3);
  ok('B/部分覆盖不算', !partial, '不该算完整覆盖');
}

/* ============ C. 块级插入位置 ============ */
section('C. 块级插入');

/** 执行一次块插入，返回最终文本 */
function applyBlock(doc, pos, block) {
  const p = core.planBlockAfter(doc, pos, block);
  return doc.slice(0, p.from) + p.insert + doc.slice(p.to);
}

{
  // 段落中间插入代码块 → 必须在行尾另起一块，原段落不被劈开
  eq('C/普通段落插代码块', applyBlock('这是普通文字', 4, '```\n\n```'),
    '这是普通文字\n\n```\n\n```');
}
{
  // 已有空行分隔的块 → 插在空行之后
  eq('C/两段之间插分隔线', applyBlock('第一段\n\n第二段', 3, '---'),
    '第一段\n\n---\n\n第二段');
}
{
  // 文档末尾
  eq('C/末尾追加', applyBlock('文字', 2, '---'), '文字\n\n---');
}
{
  // 列表项中间插入 → 列表项完整保留
  eq('C/列表项插代码块', applyBlock('- 列表项甲\n- 列表项乙', 4, '```\n\n```'),
    '- 列表项甲\n\n```\n\n```\n- 列表项乙');
}
{
  // 引用中间插入 → 引用完整保留
  eq('C/引用插分隔线', applyBlock('> 引用内容', 5, '---'), '> 引用内容\n\n---');
}
{
  // 连续三段
  eq('C/多段之间插入', applyBlock('甲\n\n乙\n\n丙', 1, '---'), '甲\n\n---\n\n乙\n\n丙');
}
{
  // 光标在中间段
  eq('C/中间段后插入', applyBlock('a\nb\nc', 2, '---'), 'a\nb\n\n---\n\nc');
}
{
  // 原段落必须完整（锚点词不被劈开）
  const after = applyBlock('这是普通文字', 4, '```\n\n```');
  ok('C/原段落完整', after.includes('这是普通文字'), after);
  ok('C/新块独立成段', /\n\n```\n\n```/.test(after), JSON.stringify(after));
}
{
  // 插入点必须在文档范围内（不能越界）
  const p = core.planBlockAfter('文字', 2, '---');
  ok('C/插入点不越界', p.from >= 0 && p.from <= 4 && p.caret <= ('文字' + p.insert).length,
    'from=' + p.from + ' caret=' + p.caret);
  const p2 = core.planBlockAfter('第一段\n\n第二段', 3, '---');
  const doc2 = '第一段\n\n第二段';
  ok('C/插入点2不越界', p2.from >= 0 && p2.from <= doc2.length && p2.caret <= (doc2.length + p2.insert.length),
    'from=' + p2.from + ' caret=' + p2.caret);
}

/* ============ D. Enter 行为 ============ */
section('D. Enter 行为');

{
  const lines = ['- 列表项'];
  const p = keys.planEnter(lines, 0, 4);
  eq('D/无序列表续行', p.type, 'list');
  eq('D/续行标记', p.marker, '- ');
}
{
  const lines = ['1. 第一项'];
  const p = keys.planEnter(lines, 0, 5);
  eq('D/有序列表续行', p.type, 'list');
  eq('D/有序编号递增', p.marker, '2. ');
}
{
  const lines = ['3. 第三项'];
  const p = keys.planEnter(lines, 0, 5);
  eq('D/有序编号接续', p.marker, '4. ');
}
{
  const lines = ['- [ ] 待办'];
  const p = keys.planEnter(lines, 0, 8);
  eq('D/任务续行为未勾', p.marker, '- [ ] ');
}
{
  const lines = ['- [x] 完成'];
  const p = keys.planEnter(lines, 0, 8);
  eq('D/已完成任务续行为未勾', p.marker, '- [ ] ');
}
{
  const lines = ['- 父项', '  - 子项'];
  const p = keys.planEnter(lines, 1, 6);
  eq('D/嵌套列表保持缩进', p.marker, '  - ');
}
{
  const lines = ['- '];
  const p = keys.planEnter(lines, 0, 2);
  eq('D/空列表项结束列表', p.type, 'end');
}
{
  const lines = ['  - '];
  const p = keys.planEnter(lines, 0, 4);
  eq('D/空缩进列表项降级', p.type, 'dedent-list');
}
{
  const lines = ['> 引用内容'];
  const p = keys.planEnter(lines, 0, 5);
  eq('D/引用续行', p.type, 'quote');
  eq('D/引用标记保留', p.marker, '> ');
}
{
  const lines = ['> '];
  const p = keys.planEnter(lines, 0, 2);
  eq('D/空引用结束', p.type, 'end');
}
{
  const lines = ['普通文字'];
  const p = keys.planEnter(lines, 0, 2);
  eq('D/普通段落拆行', p.type, 'split');
}
{
  const lines = ['| A | B |', '| --- | --- |', '| 1 | 2 |'];
  const p = keys.planEnter(lines, 2, 4);
  eq('D/表格内不插行', p.type, 'table-keep');
}

/* ============ E. Backspace 行为 ============ */
section('E. Backspace 行为');

{
  const p = keys.planBackspace(['- 列表项'], 0, 0);
  eq('E/行首删列表标记', p.type, 'delete-prefix');
  eq('E/删除长度', p.remove, 2);
}
{
  const p = keys.planBackspace(['  - 子项'], 0, 0);
  eq('E/行首先减缩进', p.type, 'outdent');
  eq('E/缩进减少2', p.remove, 2);
}
{
  const p = keys.planBackspace(['> 引用'], 0, 0);
  eq('E/行首删引用标记', p.type, 'delete-prefix');
  eq('E/引用标记长度', p.remove, 2);
}
{
  const p = keys.planBackspace(['## 标题'], 0, 0);
  eq('E/行首删标题标记', p.type, 'delete-prefix');
  eq('E/标题标记长度', p.remove, 3);
}
{
  eq('E/非行首不处理', keys.planBackspace(['- 列表项'], 0, 3), null);
  eq('E/普通段落行首不处理', keys.planBackspace(['普通'], 0, 0), null);
}

/* ============ F. Tab 行为 ============ */
section('F. Tab 行为');

{
  const cells = keys.parseTableRow('| A | B | C |');
  eq('F/表格解析格子数', cells.length, 3);
  eq('F/第一格内容', cells[0].text, 'A');
  eq('F/第一格起点指向内容', cells[0].start, 2);
  eq('F/第二格起点指向内容', cells[1].start, 6);
  eq('F/第二格内容', cells[1].text, 'B');
}
{
  const p = keys.planTab(['| A | B | C |'], 0, 4, false);
  eq('F/表格Tab跳下一格', p.type, 'next-cell');
  eq('F/跳到第二格', p.idx, 1);
}
{
  const p = keys.planTab(['| A | B | C |'], 0, 10, false);
  eq('F/最后一格Tab加行', p.type, 'add-row');
}
{
  eq('F/分隔行识别', keys.isTableDivider('| --- | --- |'), true);
  eq('F/数据行不是分隔行', keys.isTableDivider('| 1 | 2 |'), false);
}
{
  const p = keys.planTab(['- 列表项'], 0, 0, false);
  eq('F/列表Tab缩进', p.type, 'indent');
  eq('F/缩进两格', p.insert, '  ');
}
{
  const p = keys.planTab(['  - 子项'], 0, 0, true);
  eq('F/ShiftTab升级', p.type, 'outdent');
  eq('F/升级减少2格', p.remove, 2);
}

/* ============ G. 表格行生成 ============ */
section('G. 表格行');

{
  const cells = keys.parseTableRow('| A | B | C |');
  eq('G/生成空行', keys.makeTableRow(cells), '|   |   |   |');
  eq('G/生成带内容行', keys.makeTableRow(cells, ['x', '', 'z']), '| x |   | z |');
}

/* ---------- 汇总 ---------- */
let pass = 0, fail = 0;
let cur = '';
for (const r of results) {
  if (r.name.startsWith('──')) { console.log('\n' + r.name); cur = r.name; continue; }
  if (r.pass) { pass++; console.log('  ✓ ' + r.name); }
  else {
    fail++;
    console.log('  ✗ ' + r.name);
    console.log('      ' + String(r.detail).split('\n').join('\n      '));
  }
}
console.log('\n' + '='.repeat(50));
console.log('通过 ' + pass + ' / ' + (pass + fail));
if (fail) { console.log('失败 ' + fail); process.exit(1); }
console.log('✅ 全部通过');
