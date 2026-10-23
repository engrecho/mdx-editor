/**
 * 编辑内核 —— 纯函数，不碰 DOM 和 CodeMirror 实例
 *
 * 为什么要单独抽出来：
 *   1. 这些逻辑是「操作各类语法」的核心，之前散在 app.js 里，
 *      只能靠真窗口黑盒测试，定位一条要跑好几分钟。
 *   2. 抽成纯函数后可以用 jsdom 风格的对象做快速单元测试，
 *      也能在真窗口里用同一份逻辑 —— 两边行为一致。
 *
 * 约定：所有函数接收一个「文档视图适配器」 view，接口是
 *   view.state.doc        —— CodeMirror 的 Text
 *   view.state.selection  —— 选择集
 *   view.state.sliceDoc(a,b)
 *   view.dispatch(spec)
 *   view.focus()
 *
 * 这样既能接真 CodeMirror，也能接测试里的假实现。
 */

/* ============ 行前缀识别 ============ */

const RE_UL = /^(\s*[-*+]\s+)/;
const RE_OL = /^(\s*\d+[.)]\s+)/;
// ⚠ 任务列表必须有 [ ] / [x]，不能把「可选」写成可选 ——
// 那样 RE_TODO 会匹配所有无序列表，把 '- 内容' 认成任务项。
const RE_TODO = /^(\s*[-*+]\s+\[[ xX]\]\s+)/;
const RE_QUOTE = /^(\s*>\s?)/;
const RE_HEADING = /^(#{1,6})\s/;

/** 一行是不是「纯列表项」（去掉标记后还有内容） */
export function isListLine(text) {
  return RE_UL.test(text) || RE_OL.test(text);
}

/** 取列表项的标记与内容 */
export function parseListItem(text) {
  let m = text.match(RE_TODO);
  if (m) return { marker: m[1], rest: text.slice(m[1].length), kind: 'todo', checked: /\[[xX]\]/.test(m[1]) };
  m = text.match(RE_OL);
  if (m) return { marker: m[1], rest: text.slice(m[1].length), kind: 'ol', num: parseInt(m[1].trim(), 10) || 1 };
  m = text.match(RE_UL);
  if (m) return { marker: m[1], rest: text.slice(m[1].length), kind: 'ul' };
  return null;
}

/* ============ 强调区间检测 ============ */

/**
 * 找出 pos 落在哪个行内强调区间里。
 *
 * 用途：判断「选区是不是已经在粗体/斜体/删除线/行内代码里面」。
 * 之前没做这个检测，导致在 `**加粗**` 里选中「粗」再点加粗，
 * 产出 `**加****粗**` 这种嵌套垃圾。
 *
 * @returns {null | {start, end, marker, innerStart, innerEnd}}
 *   start/end   整个强调区（含标记）的起止
 *   innerStart  内容起止（不含标记）
 */
export function findEmphasisAt(docText, pos) {
  // 强调标记不能跨行，所以只看 pos 所在行
  const lineStart = docText.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = docText.indexOf('\n', pos);
  if (lineEnd < 0) lineEnd = docText.length;
  const line = docText.slice(lineStart, lineEnd);

  // 长标记优先（** 要在 * 前面匹配）
  const re = /(\*\*|__|~~|`|\*|_)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    const marker = m[1];
    const contentStart = m.index + marker.length;
    // 找配对的结束标记
    let close = -1;
    if (marker === '`') {
      close = line.indexOf('`', contentStart);
    } else {
      const re2 = new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      re2.lastIndex = contentStart;
      const m2 = re2.exec(line);
      close = m2 ? m2.index : -1;
    }
    if (close < 0) { re.lastIndex = m.index + 1; continue; }
    const innerEnd = close;
    const absStart = lineStart + m.index;
    const absEnd = lineStart + close + marker.length;
    if (pos >= absStart && pos <= absEnd) {
      return {
        start: absStart, end: absEnd, marker,
        innerStart: lineStart + contentStart, innerEnd: lineStart + innerEnd
      };
    }
    re.lastIndex = close + marker.length;
  }
  return null;
}

/**
 * 判断「选区是否完整覆盖了某个强调区间」。
 *
 * 覆盖 → 可以取消该强调（去掉整对标记）
 * 没覆盖 → 说明是「强调内部的局部操作」，此时再套一层会产生
 *          `**加****粗**` 这种嵌套垃圾，**应该放弃修改**。
 */
export function coveringEmphasis(docText, from, to) {
  const emp = findEmphasisAt(docText, from);
  if (!emp) return null;
  // 选区必须从强调起点开始、到强调终点结束，才算「完整覆盖」
  if (from <= emp.innerStart && to >= emp.innerEnd) {
    // 注意 innerStart/innerEnd 是内容范围；
    // 完整覆盖意味着选区包含了标记之外的全部内容
    return emp;
  }
  return null;
}

/* ============ 块级插入 ============ */

/**
 * 算出「在当前块之后插入一个新块」的完整变更。
 *
 * 之前 ins:code / ins:hr / ins:table 用 replaceSelection 直接在光标处插，
 * 会把所在段落从中间劈成两半：
 *   `> 这是引` + '```\n\n```' + `用内容`
 * 块级内容必须另起一块，不能插在段落中间。
 *
 * Markdown 的块是【空行分隔】的，所以插入点必须落在块边界：
 *   '第一段\n\n第二段' 在第一段后插分隔线
 *     → '第一段\n\n---\n\n第二段'   （不是 '第一段\n---\n\n第二段'）
 *
 * 三种情形：
 *   ① 后面已有空行 → 插在空行【之后】，内容 = block + 尾部空行
 *   ② 后面是普通内容 → 当前行换行之后插入 '\n' + block + '\n\n'
 *   ③ 文档末尾     → 追加 '\n\n' + block（末尾不需要尾部空行）
 *
 * @param docText  当前全文
 * @param pos      光标位置
 * @param block    要插入的块内容（不含首尾空行）
 */
export function planBlockAfter(docText, pos, block) {
  // 当前行末尾（不含换行符）与换行符之后
  const nl = docText.indexOf('\n', pos);
  const lineEnd = nl < 0 ? docText.length : nl;
  const afterNl = nl < 0 ? docText.length : nl + 1;

  // 从 afterNl 开始，跳过【所有】连续换行 —— 这些就是块之间的空行。
  // 注意：原文 '甲\n\n乙' 里，afterNl 落在第一个 '\n' 之后，
  // 剩下的是 '\n乙' —— 那个 '\n' 才是空行本身，要整个跳过去。
  let skip = 0;
  while (afterNl + skip < docText.length && docText[afterNl + skip] === '\n') skip++;
  const after = docText.slice(afterNl + skip);
  const hasContentAfter = after.trim() !== '';

  const insertAt = afterNl + skip;

  // 尾部要不要补空行：看【后面那一行】是不是同一个列表的兄弟项。
  // 同一列表的项之间加空行会变成 loose list（渲染成松散列表），
  // 所以 '- 甲' 和 '- 乙' 之间插代码块时，代码块后面只补 '\n'。
  const nextLineEnd = (() => {
    const n = docText.indexOf('\n', insertAt);
    return n < 0 ? docText.length : n;
  })();
  const nextLine = docText.slice(insertAt, nextLineEnd);
  const sameList = isListLine(lineOf(docText, pos)) && isListLine(nextLine);
  const tailGap = sameList ? '\n' : '\n\n';

  if (skip > 0) {
    // ① 后面本来就有空行 —— 插在空行之后
    //    空行被跳过了（复用了），所以新块【后面】要补回自己的空行，
    //    否则新块会和后面的内容粘在一起。
    const suffix = hasContentAfter ? tailGap : '';
    const insert = block + suffix;
    return { from: insertAt, to: insertAt, insert, caret: insertAt + block.length };
  }

  // ② 后面是普通内容 / ③ 文档末尾
  //   当前行后面本来有换行符 → 前缀一个 '\n'；否则（末尾）要 '\n\n'
  const prefix = nl < 0 ? '\n\n' : '\n';
  // 尾部要不要补空行：看【后面那一行】是不是同一个列表的兄弟项。
  // 同一列表的项之间加空行会变成 loose list（渲染成松散列表），
  // 所以 '- 甲' 和 '- 乙' 之间插代码块时，代码块后面只补 '\n'。
  const suffix = hasContentAfter ? tailGap : '';
  const insert = prefix + block + suffix;
  const caret = afterNl + insert.length - suffix.length;
  return { from: afterNl, to: afterNl, insert, caret };
}

/** 取 pos 所在行的完整文本 */
function lineOf(docText, pos) {
  const s = docText.lastIndexOf('\n', pos - 1) + 1;
  let e = docText.indexOf('\n', pos);
  if (e < 0) e = docText.length;
  return docText.slice(s, e);
}

/**
 * 算出「把整行替换成新块」的变更（用于 ins:table 这类要占一整行的）。
 *
 * 之前的行为：光标在列表项中间插表格 → 整个列表项被表格吃掉
 *   `- 列表项甲\n- 列表项乙` → `|表头...|\n\n- 列表项乙`
 * 正确行为：表格另起一块，原行保留。
 */
export function planBlockReplaceLine(docText, pos, block) {
  return planBlockAfter(docText, pos, block);
}

/* ============ 行内插入 ============ */

/**
 * 行内内容（链接、图片）可以插在光标处 —— 它们不会破坏段落结构。
 * 但要避免插在标记中间（比如插进 `**` 之间）。
 */
export function planInline(docText, pos, text, caretOffset) {
  const emp = findEmphasisAt(docText, pos);
  if (emp && pos > emp.innerStart && pos < emp.innerEnd) {
    // 在强调内容中间插入是安全的（不会切碎标记）
    return { from: pos, to: pos, insert: text, caret: pos + caretOffset };
  }
  return { from: pos, to: pos, insert: text, caret: pos + caretOffset };
}
