#!/usr/bin/env node
/**
 * 一键清理构建缓存
 *
 * 目录约定（与 AGENTS.md 一致）：
 *   release/  构建交付物（dmg / zip），electron-builder 的 directories.output 指向此处
 *   .cache/   纯临时缓存（图标生成中间产物、Electron 运行时、打包解包临时目录等）
 *
 * 因为交付物从不落在 .cache/，本命令可安全地一键清空整个 .cache/，
 * 不会误删刚打好的安装包。
 *
 * 用法：
 *   npm run cache:clean                    清空整个 .cache/（默认，交付物不受影响）
 *   npm run cache:clean -- --keep-runtime  保留 Electron 运行时，仅清其余临时文件
 */
const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, '..', '..', '.cache');
const keepRuntime = process.argv.includes('--keep-runtime') || process.argv.includes('-k');

function dirSize(dir) {
  let total = 0;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of entries) {
    const fp = path.join(dir, e.name);
    try {
      const st = fs.lstatSync(fp);
      if (st.isDirectory()) total += dirSize(fp);
      else total += st.size;
    } catch (err) { /* 文件可能已被并发删除，忽略 */ }
  }
  return total;
}

function rm(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

if (!fs.existsSync(CACHE)) {
  console.error('没有 .cache 目录，无需清理');
  process.exit(0);
}

const before = dirSize(CACHE);
console.error(`缓存目录: ${CACHE}`);
console.error(`清理前: ${(before / 1048576).toFixed(1)} MB`);

const runtime = path.join(CACHE, 'electron-mac');
const hasRuntime = fs.existsSync(runtime);

if (keepRuntime && hasRuntime) {
  for (const e of fs.readdirSync(CACHE, { withFileTypes: true })) {
    if (e.name === 'electron-mac') continue;
    rm(path.join(CACHE, e.name));
  }
  console.error('已清空临时文件，保留 Electron 运行时（下次打包更快）');
} else {
  rm(CACHE);
  console.error(hasRuntime
    ? '已清空整个 .cache/（含 Electron 运行时，下次打包会重新下载）'
    : '已清空整个 .cache/');
}

const after = fs.existsSync(CACHE) ? dirSize(CACHE) : 0;
console.error(`清理后: ${(after / 1048576).toFixed(1)} MB`);
console.error('提示：构建交付物在 release/，不受本次清理影响。');
