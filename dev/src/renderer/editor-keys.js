/**
 * Markdown 编辑交互 —— 纯函数，不碰 DOM 和 CodeMirror 实例
 *
 * 覆盖 Markdown 编辑器的基本手感（Typora / VS Code / Obsidian 都有）：
 *   · 列表项按 Enter → 自动续一行同级列表（有序列表编号递增）
 *   · 空列表项按 Enter → 结束列表（不留空壳）
 *   · 列表项行首按 Backspace → 去掉列表标记（再按一次去掉缩进）
 *   · 引用里按 Enter → 继续引用
 *   · 标题行尾按 Enter → 新行不再是标题
 *   · 表格里按 Tab → 跳到下一格；表格尾按 Tab → 加一行
 *
 * 全部是纯计算：给定「行文本 + 光标位置」，返回「要执行的编辑」，
 * 由调用方（app.js）翻译成 CodeMirror 的 transaction。
 */
import { parseListItem } from './editor-core.js';

export { parseListItem };

/**
 * 表格行解析：返回各单元格的起止位置（相对本行）
 *
 * start/end 指向【内容】的位置（不含前后空格），
 * 这样 Tab 跳格时光标正好落在文字上，而不是空格上。
 *   '| 1 | 2 |'  →  格0: start=2 end=3 ('1')
 *                    格1: start=6 end=7 ('2')
 */
export function parseTableRow(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const cells = [];
  let cur = '';
  let start = 0;
  let i = 0;
  const raw = t.startsWith('|') ? t.slice(1) : t;
  const base = t.startsWith('|') ? 1 : 0;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\' && raw[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') {
      // cur 里含前后空格，要扣掉 —— end 应该是内容的末尾
      const lead = cur.length - cur.trimStart().length;
      const trail = cur.length - cur.trimEnd().length;
      cells.push({
        start: base + start + lead,
        end: base + start + cur.length - trail,
        text: cur.trim()
      });
      cur = '';
      start = i + 1;
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '' || cells.length === 0) {
    const lead = cur.length - cur.trimStart().length;
    const trail = cur.length - cur.trimEnd().length;
    cells.push({
      start: base + start + lead,
      end: base + start + cur.length - trail,
      text: cur.trim()
    });
  }
  return cells.length ? cells : null;
}

/** 这一行是不是表格分隔行 | --- | --- | */
export function isTableDivider(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return false;
  return /^\|(\s*:?-{1,}:?\s*\|)+$/.test(t);
}

/**
 * Enter 键：算出该做什么。
 *
 * @param lines      全文按行切分
 * @param lineNo     光标所在行（0 起）
 * @param col        光标所在列
 * @returns {null | {type, ...}}
 *   type='split'    拆行（普通情况）
 *   type='list'     续列表
 *   type='end'      结束列表（把当前空列表项变回普通段落）
 *   type='quote'    继续引用
 */
export function planEnter(lines, lineNo, col) {
  const line = lines[lineNo] || '';
  const before = line.slice(0, col);
  const after = line.slice(col);

  // 空列表项 → 结束列表
  const li = parseListItem(line);
  if (li && li.rest.trim() === '') {
    const indent = li.marker.match(/^\s*/)[0];
    if (indent.length > 0) {
      return { type: 'dedent-list', indent: indent.replace(/ {1,2}$/, ''), marker: li.marker.trimStart() };
    }
    return { type: 'end' };
  }

  // 列表项 → 续同级列表
  if (li) {
    const indent = li.marker.match(/^\s*/)[0];
    if (li.kind === 'todo') {
      // 已完成的任务项按 Enter → 新的未完成任务
      if (li.checked) return { type: 'list', marker: indent + '- [ ] ', indent };
      return { type: 'list', marker: indent + '- [ ] ', indent };
    }
    if (li.kind === 'ol') {
      const n = (li.num || 1) + 1;
      return { type: 'list', marker: indent + n + '. ', indent };
    }
    return { type: 'list', marker: indent + '- ', indent };
  }
  // 引用 → 继续引用（空引用行则结束引用）
  const q = line.match(/^(\s*>\s?)(.*)$/);
  if (q) {
    if (q[2].trim() === '') return { type: 'end' };
    return { type: 'quote', marker: q[1] };
  }

  // 表格行 → Enter 不该在表格里插行（Tab 才是）
  if (parseTableRow(line) && !isTableDivider(line)) {
    return { type: 'table-keep' };
  }

  return { type: 'split' };
}

/**
 * Backspace 键：算出该做什么。
 *
 * @returns {null | {type, ...}}
 *   type='delete-prefix'  删掉行首标记（列表/引用/标题）
 *   type='outdent'        缩进减一级
 */
export function planBackspace(lines, lineNo, col) {
  if (col !== 0) return null;   // 只在行首才特殊处理
  const line = lines[lineNo] || '';
  if (!line) return null;

  const li = parseListItem(line);
  if (li) {
    const indent = li.marker.match(/^\s*/)[0];
    if (indent.length > 0) {
      const newIndent = indent.replace(/ {1,2}$/, '');
      return { type: 'outdent', remove: indent.length - newIndent.length, insert: newIndent };
    }
    return { type: 'delete-prefix', remove: li.marker.length };
  }

  const q = line.match(/^(\s*>\s?)/);
  if (q) return { type: 'delete-prefix', remove: q[1].length };

  const h = line.match(/^(#{1,6}\s)/);
  if (h) return { type: 'delete-prefix', remove: h[1].length };

  return null;
}

/**
 * Tab 键：在表格里跳到下一格，在列表里降级为子项。
 *
 * @returns {null | {type, ...}}
 *   type='next-cell'   跳到下一格的行内位置
 *   type='add-row'     在表格末尾加一行
 *   type='indent'      降级为子项
 *   type='outdent'     升级为父项
 */
export function planTab(lines, lineNo, col, shift) {
  const line = lines[lineNo] || '';
  const cells = parseTableRow(line);

  if (cells && !isTableDivider(line)) {
    let idx = cells.findIndex(c => col >= c.start && col <= c.end);
    if (idx < 0) idx = 0;
    if (shift) {
      if (idx === 0) return { type: 'table-prev-line' };
      const prev = cells[idx - 1];
      return { type: 'next-cell', col: prev.start, idx: idx - 1 };
    }
    if (idx < cells.length - 1) {
      const next = cells[idx + 1];
      return { type: 'next-cell', col: next.start, idx: idx + 1 };
    }
    return { type: 'add-row', cells };
  }

  if (shift) {
    const m = line.match(/^(\s+)/);
    if (m && m[1].length >= 2) {
      return { type: 'outdent', remove: 2 };
    }
    return null;
  }

  const li = parseListItem(line);
  if (li) {
    return { type: 'indent', insert: '  ' };
  }
  return null;
}

/** 生成一个表格新行（列数与原行一致） */
export function makeTableRow(cells, filled) {
  const n = cells.length;
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(filled && filled[i] ? filled[i] : ' ');
  }
  return '| ' + parts.join(' | ') + ' |';
}
