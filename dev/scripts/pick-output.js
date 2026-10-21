#!/usr/bin/env node
/**
 * 检查构建产物目录是否可清理。
 *
 * 背景：这台机器上有个常驻的 Electron 程序（AutoClaw）会扫描文件，
 * 它打开 .asar 时是独占模式，导致：
 *   - 目录改名失败（EPERM / Device or resource busy）
 *   - 文件删除失败
 *   - electron-builder 清空输出目录时直接报错退出
 *
 * 这个脚本在打包前跑一下：如果输出目录里有被占用的文件，
 * 换一个带时间戳的新目录，彻底避开占用。
 *
 * 用法：node scripts/pick-output.js [建议的目录名]
 * 输出：可用的绝对路径
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');
// 构建产物统一放 .cache/build，不往项目根目录扔
const base = process.argv[2] || path.join('.cache', 'build');

const REL = path.join(ROOT, '.cache', 'busy-check.txt');
fs.mkdirSync(path.dirname(REL), { recursive: true });

/** 目录里有没有被独占占用的文件 */
function hasLockedFile(dir) {
  if (!fs.existsSync(dir)) return [];
  const locked = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      // 用「改名」来探测占用，而不是打开。
      //
      // 为什么不能用 fs.openSync(p, 'r+')：Node 在 Windows 上不带 share mode，
      // 别的进程以独占方式打开时依然能「打开成功」，检测不到。
      // 而改名会真正触发系统的独占检查，报 EBUSY / EPERM。
      const tmp = p + '.lockprobe';
      try {
        fs.renameSync(p, tmp);
        fs.renameSync(tmp, p);   // 探测完还原
      } catch (err) {
        locked.push(p);
      }
    }
  };
  walk(dir, 0);
  return locked;
}

let outDir = path.join(ROOT, base);
let locked = hasLockedFile(outDir);

if (locked.length) {
  log('输出目录 %s 里有 %d 个被占用的文件', path.relative(ROOT, outDir), locked.length);
  locked.slice(0, 3).forEach(f => log('  %s', path.relative(ROOT, f)));
  // 换一个新目录名，彻底避开占用（仍在 .cache/ 下）
  const stamp = Date.now().toString(36);
  outDir = path.join(ROOT, base + '-' + stamp);
  log('改用新目录: %s', path.relative(ROOT, outDir));
} else {
  log('输出目录 %s 可用', path.relative(ROOT, outDir));
}

fs.writeFileSync(REL, outDir, 'utf8');
log('输出目录: %s', outDir);
