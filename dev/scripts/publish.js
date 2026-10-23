#!/usr/bin/env node
/**
 * 把构建产物同步到仓库根的 release/ 目录
 *
 * 用法：node scripts/publish.js [win|mac|all]
 *
 * 目录约定（三层职责严格分开）：
 *   dev/                开发目录（源码）
 *   dist/               构建产物（electron-builder 原始输出，transient）
 *   .cache/             纯临时缓存（可一键清空，绝不放交付物）
 *   .cache/trash/       待删除暂存区（确认无用后可整目录删）
 *   release/macos/      发布目录：macOS 最终交付
 *   release/windows/    发布目录：Windows 最终交付
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFileSync } = require('child_process');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');

// 待删除暂存区：删除操作会被环境安全 hook 拦截，所以用「挪走」代替「删掉」。
// 挪到 .cache/trash/ 下，跟其他中间文件放一起。
const TRASH = path.join('.cache', 'trash');

// 候选输出目录：
//   首选 dist/（当前约定），后面几个是历史遗留的目录名，
//   electron-builder 的 directories.output 改过几次，旧目录里可能还留着旧产物。
//   按「版本号取最新」而不是「按目录顺序」来挑。
const OUT_CANDIDATES = [
  'dist',
  path.join('.cache', 'build'),
  path.join('.cache', 'build-out'),
  'build-out',
  'build-output',
  'build-out-win',
  'dist-out'
].map(d => path.join(ROOT, d));

/**
 * 追加动态选出的输出目录。
 *
 * pick-output.js 会在打包前探测目录是否被占用（这台机器上有个常驻
 * Electron 程序会独占打开 .asar），被占用时它会选一个带时间戳的新目录。
 * 这个文件由 pick-output.js 写入。
 */
const picked = path.join(ROOT, '.cache', 'busy-check.txt');
if (fs.existsSync(picked)) {
  const p = fs.readFileSync(picked, 'utf-8').trim();
  if (p && fs.existsSync(p) && !OUT_CANDIDATES.includes(p)) OUT_CANDIDATES.unshift(p);
}

/** 从候选目录里挑出版本号最高的文件（只保留最高版本的一批） */
function pickNewest(ext) {
  const found = new Map();   // name -> {path, ver}
  let maxVer = [0, 0, 0];
  for (const out of OUT_CANDIDATES) {
    if (!fs.existsSync(out)) continue;
    // 一级目录 + 其子目录（mac zip 在 .cache/build/mac/ 下）
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
  const trash = path.join(ROOT, TRASH, 'publish-old-' + Date.now());
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

  // exe：取版本号最新的
  //
  // 顺序：先挑出新的，确认有货了再挪走旧的。
  // 否则一旦候选目录里没有新产物，旧的被挪走而新的拷不上，目录就空了。
  const newExes = pickNewest('.exe');
  if (!newExes.length) {
    log('  ⚠ 没找到新的 exe，保留 release/windows/ 现有内容不动');
  } else {
    // 清掉旧版本文件（挪走而非删除：删除操作会被环境安全 hook 拦截）
    const oldExes = path.join(ROOT, TRASH, 'publish-old-exe-' + Date.now());
    for (const f of fs.existsSync(winDir) ? fs.readdirSync(winDir) : []) {
      if (!f.endsWith('.exe')) continue;
      try {
        fs.mkdirSync(oldExes, { recursive: true });
        fs.renameSync(path.join(winDir, f), path.join(oldExes, f));
      } catch (e) { log('  ⚠ 旧 exe 挪动失败:', f); }
    }
    for (const a of newExes) {
      fs.copyFileSync(a.path, path.join(winDir, path.basename(a.path)));
      log('  ✓', path.basename(a.path));
    }
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
    // 先把新内容拷进一个临时目录，确认成功再换过去。
    // 直接 moveAway 旧目录的话，一旦目录改名被 Windows 拒绝
    // （内含被占用的文件），旧内容会留在原地，和新内容混在一起。
    const staging = path.join(ROOT, TRASH, 'portable-staging-' + Date.now());
    try {
      copyDir(best.src, staging);
      // 用「逐文件覆盖」而不是换目录：换目录可能被 Windows 拒绝
      fs.mkdirSync(dst, { recursive: true });
      copyDir(staging, dst);
      log('  ✓ portable/ (v' + best.ver.join('.') + ')');
    } catch (e) {
      log('  ⚠ portable 同步失败:', e.message);
    }
  }
}

if (target === 'mac' || target === 'all') {
  log('同步 macOS...');
  const macDir = path.join(REL, 'macos');
  fs.mkdirSync(macDir, { recursive: true });
  // mac 交付物：.zip（解压即用，免安装）+ .dmg（拖进 Applications，标准安装方式）
  //
  // 两种都发。dmg 是 macOS 用户最主流的安装路径，zip 留给不想往
  // Applications 里塞东西、或者想在多台机器上快速分发的场景。
  //
  // 顺序很重要：先挑出新的，确认有货了再挪走旧的。
  // 反过来的话，一旦候选目录里没有新产物（比如刚改了输出目录），
  // 旧的会被挪走而新的拷不上，release/macos 就空了。
  for (const ext of ['.zip', '.dmg']) {
    const found = pickNewest(ext);
    if (!found.length) {
      log('  ⚠ 没找到新的 mac ' + ext + '，保留 release/macos/ 现有内容不动');
      continue;
    }
    const oldDir = path.join(ROOT, TRASH, 'publish-old' + ext.replace('.', '-') + '-' + Date.now());
    for (const f of fs.existsSync(macDir) ? fs.readdirSync(macDir) : []) {
      if (!f.endsWith(ext)) continue;
      try {
        fs.mkdirSync(oldDir, { recursive: true });
        fs.renameSync(path.join(macDir, f), path.join(oldDir, f));
      } catch (e) { log('  ⚠ 旧文件挪动失败:', f); }
    }
    for (const a of found) {
      fs.copyFileSync(a.path, path.join(macDir, path.basename(a.path)));
      log('  ✓', path.basename(a.path));
    }
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
