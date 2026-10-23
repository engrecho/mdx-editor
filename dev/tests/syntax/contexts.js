/**
 * 语法上下文 × 操作 矩阵 —— 测试数据
 *
 * CommonJS（主进程 require 用），页面侧通过 JSON 注入。
 */

/** 18 种 Markdown 语法上下文 */
const CONTEXTS = [
  { id: 'plain',      name: '普通段落',    doc: '这是一段普通文字',              cursor: 4 },
  { id: 'h1',         name: 'H1 标题',     doc: '# 一级标题',                    cursor: 3 },
  { id: 'h3',         name: 'H3 标题',     doc: '### 三级标题',                  cursor: 5 },
  { id: 'bold',       name: '粗体',        doc: '这是**加粗**的文字',            cursor: 5 },
  { id: 'italic',     name: '斜体',        doc: '这是*斜体*的文字',              cursor: 3 },
  { id: 'strike',     name: '删除线',      doc: '这是~~删除~~的文字',            cursor: 5 },
  { id: 'inlinecode', name: '行内代码',    doc: '这是`代码`的文字',              cursor: 3 },
  { id: 'fence',      name: '代码块',      doc: '```js\nconst a = 1;\n```',       cursor: 12 },
  { id: 'quote',      name: '引用',        doc: '> 这是引用内容',                cursor: 5 },
  { id: 'ul',         name: '无序列表',    doc: '- 列表项甲\n- 列表项乙',        cursor: 4 },
  { id: 'ol',         name: '有序列表',    doc: '1. 列表项甲\n2. 列表项乙',      cursor: 4 },
  { id: 'todo',       name: '任务列表',    doc: '- [ ] 待办一\n- [x] 已完成',    cursor: 6 },
  { id: 'nested',     name: '嵌套列表',    doc: '- 父项\n  - 子项',              cursor: 6 },
  { id: 'table',      name: '表格',        doc: '| A | B |\n| --- | --- |\n| 1 | 2 |', cursor: 4 },
  { id: 'link',       name: '链接',        doc: '看这个[链接](https://a.com)',   cursor: 4 },
  { id: 'image',      name: '图片',        doc: '![描述](img.png)',             cursor: 4 },
  { id: 'hr',         name: '分隔线',      doc: '前面\n\n---\n\n后面',           cursor: 2 },
  { id: 'mixed',      name: '混排',        doc: '# 标题\n\n正文有**粗体**和`代码`\n\n- 列表', cursor: 8 },
  { id: 'empty',      name: '空文档',      doc: '',                             cursor: 0 },
  { id: 'blankline',  name: '空行之间',    doc: '上段\n\n\n下段',              cursor: 4 }
];

/** 16 个命令 */
const COMMANDS = [
  'fmt:bold', 'fmt:italic', 'fmt:strike', 'fmt:code',
  'fmt:h1', 'fmt:h2', 'fmt:h3',
  'ins:table', 'ins:quote', 'ins:code', 'ins:ul', 'ins:ol', 'ins:todo',
  'ins:hr', 'ins:link', 'ins:image'
];

/**
 * 每个上下文里「必须仍然存在」的结构。
 *
 * 拆成两类，因为它们的判定强度不同：
 *   head    —— 行首标记，必须还在（说明该块的结构没被破坏）
 *   content —— 内容关键词，不能被拆散（说明段落没被劈成两半）
 *
 * 注意不能用「完整文本连续」来判定 —— 在标题中间加粗会得到
 * `# 一****级标题`，这是**合理**的行为（标题里可以有粗体），
 * 但 `# 一级标题` 不再连续。所以只查标记和关键词。
 */
const INTEGRITY = {
  h1:         { head: ['# '], content: ['一级标题'] },
  h3:         { head: ['### '], content: ['三级标题'] },
  bold:       { head: [], content: ['加粗', '文字'] },
  italic:     { head: [], content: ['斜体', '文字'] },
  strike:     { head: [], content: ['删除', '文字'] },
  inlinecode: { head: [], content: ['代码', '文字'] },
  fence:      { head: ['```'], content: ['const a = 1;'] },
  quote:      { head: ['> '], content: ['引用内容'] },
  ul:         { head: ['- '], content: ['列表项甲', '列表项乙'] },
  ol:         { head: ['1. '], content: ['列表项甲', '列表项乙'] },
  todo:       { head: ['- ['], content: ['待办一', '已完成'] },
  nested:     { head: ['- 父项'], content: ['子项'] },
  table:      { head: ['|'], content: ['A', 'B', '---'] },
  link:       { head: [], content: ['链接'] },
  image:      { head: [], content: ['描述'] },
  hr:         { head: ['---'], content: ['前面', '后面'] },
  mixed:      { head: ['# ', '- '], content: ['标题', '粗体', '代码', '列表'] }
};

/**
 * 「段落被劈开」的判定锚点 —— 取上下文里一段连续的中文/英文词，
 * 操作后它必须仍然连续出现（否则说明被插东西劈开了）。
 * 单独列出，因为有些上下文的判定锚点不同。
 */
const ANCHORS = {
  plain:      '普通文字',
  h1:         '一级标题',
  h3:         '三级标题',
  bold:       '加粗',
  italic:     '斜体',
  strike:     '删除',
  inlinecode: '代码',
  fence:      'const a = 1;',
  quote:      '引用内容',
  ul:         '列表项甲',
  ol:         '列表项甲',
  todo:       '待办一',
  nested:     '父项',
  table:      'A',
  link:       '链接',
  image:      '描述',
  hr:         '前面',
  mixed:      '标题'
};

module.exports = { CONTEXTS, COMMANDS, INTEGRITY, ANCHORS };
