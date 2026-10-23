#!/usr/bin/env node
/**
 * 打包入口：自动避开被占用的输出目录。
 *
 * 为什么需要这个：这台机器上有个常驻的 Electron 程序（AutoClaw）会
 * 独占打开 .asar，导致 electron-builder 清空输出目录时直接失败
 * （remove ...app.asar: The process cannot access the file because it
 * is being used by another process）。
 *
 * 做法：打包前探测输出目录，被占用就换一个带时间戳的新目录。
 *
 * 用法：
 *   node scripts/pack.js win          打 Windows（nsis + portable）
 *   node scripts/pack.js mac          打 macOS（dmg + zip）
 *   node scripts/pack.js mac dmg      只打 macOS dmg
 *   node scripts/pack.js mac zip      只打 macOS zip
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const { spawnSync } = require('child_process');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');
const BASE_OUT = 'dist';

const target = process.argv[2] || 'win';
const flavor = process.argv[3];

/* ---------- 1. 构建渲染层 ---------- */
log('==> 构建渲染层...');
const rb = spawnSync(process.execPath, [path.join(DEV, 'scripts', 'build-renderer.js')],
  { stdio: 'inherit', cwd: DEV });
if (rb.status !== 0) {
  log('X 渲染层构建失败');
  process.exit(1);
}

/* ---------- 2. 选一个不被占用的输出目录 ---------- */
const probe = spawnSync(process.execPath, [path.join(DEV, 'scripts', 'pick-output.js'), BASE_OUT],
  { stdio: 'inherit', cwd: DEV });
if (probe.status !== 0) process.exit(1);

const pickedFile = path.join(ROOT, '.cache', 'busy-check.txt');
if (!fs.existsSync(pickedFile)) {
  log('X 未能确定输出目录');
  process.exit(1);
}
const outDir = fs.readFileSync(pickedFile, 'utf-8').trim();
log('==> 输出目录: %s', path.relative(ROOT, outDir));

/* ---------- 3. 调 electron-builder ---------- */
const args = ['electron-builder'];
if (target === 'win') {
  args.push('--win', '--x64');
} else if (target === 'mac') {
  args.push('--mac');
  if (flavor === 'dmg' || flavor === 'zip') args.push(flavor);
} else {
  log('X 未知目标: %s（可用: win / mac）', target);
  process.exit(1);
}
args.push('--config.directories.output=' + outDir);

log('==> electron-builder %s', args.slice(1).join(' '));
const eb = spawnSync('npx', args, {
  stdio: 'inherit',
  cwd: DEV,
  shell: true,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
});
process.exit(eb.status === null ? 1 : eb.status);
