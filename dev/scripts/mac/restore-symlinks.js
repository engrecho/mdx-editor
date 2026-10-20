#!/usr/bin/env node
/**
 * 把解压时留下的 .__symlink 标记还原成真正的符号链接
 *
 * 背景：Windows 无法创建 Unix 符号链接（需管理员或开发者模式），
 * 所以 unzip.js 把链接存成「普通文件 + .__symlink 标记文件」。
 * 打包成 mac .app 前必须还原，否则 mac 解压后框架结构损坏，
 * 表现为「应用已损坏，无法打开」。
 *
 * 还原策略：
 *   1. 优先用 fs.symlinkSync（若 Windows 允许）
 *   2. 失败则用 junction（仅目录可用）
 *   3. 都不行 → 保留标记文件，并在压缩阶段把它作为链接写入 zip
 *      （zip.js 会识别 .__symlink 标记并按 S_IFLNK 存）
 *
 * 第3 条是保底路径：即使本机完全无法创建链接，压缩出的 zip
 * 里的链接信息依然正确，mac 解压时会正常还原。
 */
const fs = require('fs');
const path = require('path');

/** 递归找出所有 .__symlink 标记 */
function findMarks(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) findMarks(fp, out);
    else if (e.name.endsWith('.__symlink')) out.push(fp);
  }
  return out;
}

/**
 * 还原单个链接
 * @returns 'symlink' | 'junction' | 'marker'  处理方式
 */
function restoreOne(markPath) {
  const target = fs.readFileSync(markPath, 'utf-8').trim();
  const linkPath = markPath.slice(0, -'.__symlink'.length);

  // 目标路径可能相对于链接所在目录
  const absTarget = path.isAbsolute(target)
    ? target
    : path.resolve(path.dirname(linkPath), target);

  // 关键：zip 里必须保留「原始相对目标」（如 Versions/Current -> A），
  // 转成绝对路径会让 mac 解压后链接全断，应用报「已损坏」。
  const linkTarget = target;

  try { fs.unlinkSync(linkPath); } catch (e) {}

  // 1) 标准符号链接（用原始相对目标，Windows 下相对链接会失败则回落标记）
  try {
    fs.symlinkSync(linkTarget, linkPath, 'file');
    return 'symlink';
  } catch (e) {}

  // 2) 目录用junction
  try {
    if (fs.existsSync(absTarget) && fs.statSync(absTarget).isDirectory()) {
      fs.symlinkSync(absTarget, linkPath, 'junction');
      return 'junction';
    }
  } catch (e) {}

  // 3) 保底：写成普通文件（内容=链接目标），保留 .__symlink 标记
  //    zip.js 会识别标记并按符号链接写入压缩包
  try {
    fs.writeFileSync(linkPath, target);
    return 'marker';
  } catch (e) {
    return 'failed';
  }
}

function main(root) {
  const marks = findMarks(root);
  if (!marks.length) {
    console.log('  无 .__symlink 标记');
    return;
  }
  const stat = { symlink: 0, junction: 0, marker: 0, failed: 0 };
  for (const m of marks) {
    const r = restoreOne(m);
    stat[r]++;
  }
  console.log(`  还原 ${marks.length} 个链接：真链接 ${stat.symlink}、junction ${stat.junction}、标记保底 ${stat.marker}、失败 ${stat.failed}`);
}

module.exports = { main, findMarks, restoreOne };

if (require.main === module) {
  main(process.argv[2] || process.cwd());
}
