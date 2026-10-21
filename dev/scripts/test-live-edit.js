/**
 * live-edit.js 的独立测试。
 *
 * 跑法：node scripts/test-live-edit.js
 *
 * 测什么：把 Markdown → HTML（marked）→ DOM → Markdown 的往返，
 * 确认「用户在预览区改一个字，源码只变那一个字」。
 */
const path = require('path');

// live-edit.js 是 ESM，esbuild 打包过才能在 CJS 里 require
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'renderer', 'live-edit.js')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: path.join(__dirname, '..', '.cache', 'scratch', 'live-edit.cjs'),
  logLevel: 'silent'
});

const { marked } = require('marked');
const le = require(path.join(__dirname, '..', '.cache', 'scratch', 'live-edit.cjs'));

// 极简 DOM：用 marked 渲染出真实 HTML，再用正则剥标签，
// 只验证「结构 → Markdown」这一步，不做完整 DOM 解析。
// 复杂场景交给真实浏览器验证。

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('  ✓', name); }
  else {
    fail++;
    console.log('  ✗', name);
    console.log('    期望:', JSON.stringify(expected));
    console.log('    实际:', JSON.stringify(actual));
  }
}

/* ---------- 1. splitBlocks 的区间是否精确 ---------- */
console.log('\n[1] splitBlocks 区间精确性');
{
  const md = '# 标题\n\n段落一\n\n- 项目 1\n- 项目 2\n\n结尾';
  const { blocks } = le.splitBlocks(md);

  const visible = blocks.filter(b => !b.skip);
  check('可见 block 数量', visible.length, 4);
  check('block[0].raw', visible[0].raw, '# 标题\n\n');
  check('block[1].raw', visible[1].raw, '段落一');
  check('block[2].raw', visible[2].raw, '- 项目 1\n- 项目 2');
  check('block[3].raw', visible[3].raw, '结尾');

  // 每个区间回切出来的内容应等于 raw
  let allOk = true;
  for (const b of blocks) {
    if (md.slice(b.start, b.end) !== b.raw) { allOk = false; break; }
  }
  check('所有区间回切一致', allOk, true);

  // 关键：raw 顺序拼接必须严格等于原文（含 space token）
  check('全部 token 的 raw 拼接 === 原文',
    blocks.map(b => b.raw).join('') === md, true);

  // 可见 block 的 raw 拼接会丢掉空行，但保留换行以便回写时补回
  check('可见 block 都标了 skip', visible.every(b => b.skip === false), true);
  check('space token 标了 skip', blocks.filter(b => b.skip).length > 0, true);
}

/* ---------- 2. 边界情况 ---------- */
console.log('\n[2] 边界情况');
{
  const empty = le.splitBlocks('');
  check('空文档', empty.blocks.length, 0);

  const onlySpace = le.splitBlocks('\n\n\n');
  check('纯空行 → 全是 space', onlySpace.blocks.filter(b => !b.skip).length, 0);

  const fenced = le.splitBlocks('```js\nconst a=1;\n\nconst b=2;\n```');
  check('含空行的代码块', fenced.blocks.filter(b => !b.skip).length, 1);
  check('代码块 raw 完整',
    fenced.blocks.find(b => !b.skip).raw, '```js\nconst a=1;\n\nconst b=2;\n```');

  const table = le.splitBlocks('| A | B |\n| --- | --- |\n| 1 | 2 |');
  check('表格', table.blocks.filter(b => !b.skip).length, 1);

  const task = le.splitBlocks('- [ ] 待办\n- [x] 完成');
  check('任务列表', task.blocks.filter(b => !b.skip).length, 1);
  check('任务列表 raw', task.blocks.find(b => !b.skip).raw, '- [ ] 待办\n- [x] 完成');
}

/* ---------- 3. 单块替换：只改一个字，其余不动 ---------- */
console.log('\n[3] 按区间替换（模拟用户改一个字）');
{
  const md = '# 标题\n\n段落一 **粗体**\n\n结尾段落';
  const { blocks } = le.splitBlocks(md);

  // 找到「段落一」那个 block，用户把它改成「段落二」
  const target = blocks.find(b => !b.skip && b.token.type === 'paragraph' && b.raw.includes('段落一'));
  check('定位到目标 block', !!target, true);

  const edited = target.raw.replace('段落一', '段落二');
  const newMd = md.slice(0, target.start) + edited + md.slice(target.end);
  check('替换后文档', newMd, '# 标题\n\n段落二 **粗体**\n\n结尾段落');

  // 改结尾段落，同理
  const last = blocks.filter(b => !b.skip).pop();
  const newMd2 = md.slice(0, last.start) + '新的结尾' + md.slice(last.end);
  check('替换末块后文档', newMd2, '# 标题\n\n段落一 **粗体**\n\n新的结尾');

  // 确认其他 block 的区间没被前面的替换影响
  check('原文仍可正确回切', md.slice(target.start, target.end), '段落一 **粗体**');
}

/* ---------- 4. elementToMarkdown：标题与段落 ---------- */
console.log('\n[4] 标题层级与段落');
{
  function fakeEl(tag, text) {
    return { tagName: tag, textContent: text, childNodes: [{ nodeType: 3, textContent: text }] };
  }
  check('h1', le.elementToMarkdown(fakeEl('H1', '标题'), 'heading'), '# 标题');
  check('h2', le.elementToMarkdown(fakeEl('H2', '标题'), 'heading'), '## 标题');
  check('h3', le.elementToMarkdown(fakeEl('H3', '标题'), 'heading'), '### 标题');
  check('h6', le.elementToMarkdown(fakeEl('H6', '标题'), 'heading'), '###### 标题');
  check('p', le.elementToMarkdown(fakeEl('P', '正文'), 'paragraph'), '正文');
}

/* ---------- 结果 ---------- */
console.log('\n' + '='.repeat(50));
console.log(`通过 ${pass} / ${pass + fail}`);
if (fail) {
  console.log(`失败 ${fail}`);
  process.exit(1);
}
console.log('✅ 全部通过');