#!/usr/bin/env node
/**
 * 清理构建缓存
 *
 * .cache/ 下有两类内容：
 *   electron-mac/  Electron mac 运行时 zip（约 196MB，删了下次要重下）
 *   mac-build/     打包时的临时解包目录（每次几百MB，纯垃圾，可随时删）
 *
 * 用法：
 *   npm run cache:clean           删临时解包目录，保留运行时
 *   npm run cache:clean -- --all  连运行时一起删（回收约 700MB）
 */
const fs = require('fs');
const path = require('path');

const log = (s, ...a) => console.error(String(s).replace(/\{(\d+)\}/g, (_, i) => a[+i]));

const CACHE = path.join(__dirname, '..', '.cache');
const deleteAll = process.argv.includes('--all') || process.argv.includes('-a');

function dirSize(dir) {
  let total = 0;
  const walk = (p) => {
    let st;
    try { st = fs.lstatSync(p); } catch (e) { return; }
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    } else total += st.size;
  };
  walk(dir);
  return total;
}

function rmDir(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) rmDir(fp);
    else fs.unlinkSync(fp);
  }
  fs.rmdirSync(dir);
}

if (!fs.existsSync(CACHE)) {
  log('没有缓存目录，无需清理');
  process.exit(0);
}

log(`缓存目录: ${CACHE}\n`);

const tmpDir = path.join(CACHE, 'mac-build');
if (fs.existsSync(tmpDir)) {
  const mb = dirSize(tmpDir) / 1048576;
  log('删除临时解包目录 mac-build ({0} MB) ...', Math.round(mb));
  try {
    rmDir(tmpDir);
    log('  ✓ 已删除');
  } catch (e) {
    log('  ✗ 失败: {0}', e.message);
  }
} else {
  log('mac-build 不存在，跳过');
}

const rtDir = path.join(CACHE, 'electron-mac');
if (deleteAll && fs.existsSync(rtDir)) {
  const mb = dirSize(rtDir) / 1048576;
  log('\n删除运行时缓存 electron-mac (%.0f MB) ...', mb);
  try {
    rmDir(rtDir);
    log('  ✓ 已删除，下次打包需重新执行 npm run mac:fetch');
  } catch (e) {
    log('  ✗ 失败: {0}', e.message);
  }
} else if (fs.existsSync(rtDir)) {
  const mb = dirSize(rtDir) / 1048576;
  log('\n保留运行时缓存 electron-mac ({0} MB)，加 --all 可一并删除', Math.round(mb));
}

const rest = dirSize(CACHE) / 1048576;
log('\n当前缓存总计: {0} MB', Math.round(rest));
