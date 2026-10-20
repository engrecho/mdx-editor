#!/usr/bin/env node
/**
 * 把构建产物同步到仓库根的 release/ 目录
 *
 * 用法：node scripts/publish.js [win|mac|all]
 *
 * 目录约定：
 *   dev/           开发目录（源码）
 *   build-output/  构建中间产物
 *   release/       发布目录（最终交付）
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFileSync } = require('child_process');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');
// 候选输出目录：electron-builder 的 directories.output 历史上被改过几次，
// 且各目录里可能残留不同版本的产物。所以按「版本号取最新」而不是「按目录顺序」。
const OUT_CANDIDATES = ['build-output', 'build-out-win', 'dist-out']
  .map(d => path.join(ROOT, d));

/** 从候选目录里挑出版本号最高的文件（只保留最高版本的一批） */
function pickNewest(ext) {
  const found = new Map();   // name -> {path, ver}
  let maxVer = [0, 0, 0];
  for (const out of OUT_CANDIDATES) {
    if (!fs.existsSync(out)) continue;
    // 一级目录 + 其子目录（mac zip 在 build-output/mac/ 下）
    const files = [];
    for (const f of fs.readdirSync(out)) {
      const fp = path.join(out, f);
      if (fs.statSync(fp).isDirectory()) {
        for (const g of fs.readdirSync(fp)) files.push({ name: g, full: path.join(fp, g) });
      } else files.push({ name: f, full: fp });
    }
    for (const it of files) {
      const f = it.name;
      if (!f.endsWith(ext)) continue;
      const m = f.match(/(\d+)\.(\d+)\.(\d+)/);
      if (!m) continue;
      const ver = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      const key = ver.join('.');
      if (key > maxVer.join('.')) maxVer = ver;
      const prev = found.get(f);
      if (!prev || ver.join('.') > prev.ver.join('.')) {
        found.set(f, { path: it.full, ver });
      }
    }
  }
  // 只返回最高版本的文件
  const top = maxVer.join('.');
  return [...found.values()].filter(a => a.ver.join('.') === top);
}
const REL = path.join(ROOT, 'release');

const target = process.argv[2] || 'all';

function cp(src, dst) {
  if (!fs.existsSync(src)) { log('  跳过（不存在）:', path.basename(src)); return false; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
  return true;
}

/**
 * 递归拷贝目录。
 *
 * 不用 fs.cpSync —— 它在含中文的路径上会崩（Windows 上退出码
 * 0xC0000409 STATUS_STACK_BUFFER_OVERRUN），而本项目的路径里
 * 恰好有「云电脑同步」这五个字。改成手写 readdir + copyFile。
 */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src)) {
    const s = path.join(src, e), d = path.join(dst, e);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * 把旧目录挪到一边（不删除）。
 *
 * 为什么不用 unlink/rmdir：本环境的删除操作会被安全 hook 拦截
 * （SAFE_DELETE_FAIL_CLOSED / trash-failed），一旦失败就会把
 * 目录改名成 `xxxX` 之类的残留名，产物里就会混进垃圾。
 * 改名是可逆且不受该 hook 影响的，所以「挪走」比「删掉」可靠。
 */
function moveAway(dir) {
  if (!fs.existsSync(dir)) return;
  const trash = path.join(ROOT, '_to_delete', 'publish-old-' + Date.now());
  fs.mkdirSync(path.dirname(trash), { recursive: true });
  try {
    fs.renameSync(dir, trash);
    log('  旧版本已挪至', path.relative(ROOT, trash));
  } catch (e) {
    log('  ⚠ 挪动旧目录失败（保留原样）:', e.message);
  }
}

if (target === 'win' || target === 'all') {
  log('同步 Windows...');
  const winDir = path.join(REL, 'windows');
  fs.mkdirSync(winDir, { recursive: true });

  // 清掉旧版本文件（挪走而非删除：删除操作会被环境安全 hook 拦截）
  const oldExes = path.join(ROOT, '_to_delete', 'publish-old-exe-' + Date.now());
  for (const f of fs.existsSync(winDir) ? fs.readdirSync(winDir) : []) {
    if (!f.endsWith('.exe')) continue;
    try {
      fs.mkdirSync(oldExes, { recursive: true });
      fs.renameSync(path.join(winDir, f), path.join(oldExes, f));
    } catch (e) { log('  ⚠ 旧 exe 挪动失败:', f); }
  }

  // exe：取版本号最新的
  for (const a of pickNewest('.exe')) {
    fs.copyFileSync(a.path, path.join(winDir, path.basename(a.path)));
    log('  ✓', path.basename(a.path));
  }

  // 免安装目录版：找版本号最新的 win-unpacked
  let best = null;
  for (const out of OUT_CANDIDATES) {
    const src = path.join(out, 'win-unpacked');
    if (!fs.existsSync(src)) continue;
    const verFile = path.join(src, 'resources', 'app-update.yml');
    let ver = [0, 0, 0];
    if (fs.existsSync(verFile)) {
      const t = fs.readFileSync(verFile, 'utf-8');
      const m = t.match(/version:\s*(\d+)\.(\d+)\.(\d+)/);
      if (m) ver = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    }
    if (!best || ver.join('.') > best.ver.join('.')) best = { src, ver };
  }
  if (best) {
    const dst = path.join(winDir, 'portable');
    // 旧目录先挪走再拷新，避免旧版本文件混进新包
    moveAway(dst);
    copyDir(best.src, dst);
    log('  ✓ portable/ (v' + best.ver.join('.') + ')');
  }
}

if (target === 'mac' || target === 'all') {
  log('同步 macOS...');
  const macDir = path.join(REL, 'macos');
  fs.mkdirSync(macDir, { recursive: true });
  const oldZips = path.join(ROOT, '_to_delete', 'publish-old-zip-' + Date.now());
  for (const f of fs.existsSync(macDir) ? fs.readdirSync(macDir) : []) {
    if (!f.endsWith('.zip')) continue;
    try {
      fs.mkdirSync(oldZips, { recursive: true });
      fs.renameSync(path.join(macDir, f), path.join(oldZips, f));
    } catch (e) { log('  ⚠ 旧 zip 挪动失败:', f); }
  }
  // mac zip：取版本号最新的
  const macZips = pickNewest('.zip');
  for (const a of macZips) {
    fs.copyFileSync(a.path, path.join(macDir, path.basename(a.path)));
    log('  ✓', path.basename(a.path));
  }
}

// 说明文件从 docs/ 同步
const docMap = {
  'docs/Windows使用说明.md': 'release/windows/说明.md',
  'docs/macOS使用说明.md': 'release/macos/说明.md'
};
for (const [src, dst] of Object.entries(docMap)) {
  const s = path.join(ROOT, src);
  if (fs.existsSync(s)) {
    fs.mkdirSync(path.dirname(path.join(ROOT, dst)), { recursive: true });
    fs.copyFileSync(s, path.join(ROOT, dst));
    log('  ✓', dst);
  }
}

log('\n发布目录: %s', REL);
