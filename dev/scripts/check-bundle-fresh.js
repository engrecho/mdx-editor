#!/usr/bin/env node
/**
 * 检查渲染层 bundle 是不是比源码旧。
 *
 * 为什么需要这个：
 *   app.bundle.js 是 esbuild 产物，被 .gitignore 排除，不入库。
 *   而 index.html 引用的是 bundle。所以只要改了 app.js / style.css /
 *   index.html 而忘了重新构建，页面跑的就是旧代码 —— 而且
 *   **HTML 和 JS 版本还不匹配**，症状是「各种说不清的怪 bug」。
 *
 *   v1.4.0 / v1.5.0 连续两个版本都踩了这个坑：改了 app.js 但没重建
 *   bundle，用户实际跑的一直是 v1.3.0 的界面 + 旧逻辑，
 *   而新版修的 bug（列表作用位置、预览区失焦）压根没生效。
 *
 * 检查逻辑：比对 bundle 的 mtime 和源文件的 mtime。任何一个源文件更新
 * 就判定为过期。
 *
 * 用法：
 *   node scripts/check-bundle-fresh.js          # 只检查
 *   node scripts/check-bundle-fresh.js --fix    # 过期就自动重建
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const { spawnSync } = require('child_process');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const RENDERER = path.join(DEV, 'src', 'renderer');

const BUNDLES = ['app.bundle.js', 'update.bundle.js'];
const SOURCES = [
  'app.js', 'update.js', 'live-edit.js',
  'index.html', 'style.css'
];

const FIX = process.argv.includes('--fix');

function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; }
}

const problems = [];

// bundle 缺失
for (const b of BUNDLES) {
  if (!fs.existsSync(path.join(RENDERER, b))) {
    problems.push({ kind: 'missing', file: b });
  }
}

// bundle 比源文件旧
if (!problems.length) {
  for (const b of BUNDLES) {
    const bt = mtime(path.join(RENDERER, b));
    for (const s of SOURCES) {
      const st = mtime(path.join(RENDERER, s));
      if (st > bt) {
        problems.push({
          kind: 'stale', bundle: b, source: s,
          gap: ((st - bt) / 1000).toFixed(0) + ' 秒'
        });
      }
    }
  }
}

if (!problems.length) {
  log('✅ bundle 是最新的');
  log('   app.bundle.js / update.bundle.js 与源码同步');
  process.exit(0);
}

log('X bundle 与源码不同步：');
for (const p of problems) {
  if (p.kind === 'missing') {
    log('   缺失: %s', p.file);
  } else {
    log('   %s 比 %s 旧 %s', p.bundle, p.source, p.gap);
  }
}

if (!FIX) {
  log('');
  log('修复：npm run build:renderer');
  log('（或加 --fix 让本脚本自动重建）');
  process.exit(1);
}

log('\n自动重建...');
const r = spawnSync(process.execPath, [path.join(__dirname, 'build-renderer.js')],
  { stdio: 'inherit', cwd: DEV });
process.exit(r.status === 0 ? 0 : 1);
