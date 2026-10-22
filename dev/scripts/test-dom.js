#!/usr/bin/env node
/**
 * 跑 tests/dom/main.js 里的真实 DOM 测试。
 *
 * 流程：
 *   1. esbuild 把测试代码 + live-edit.js + marked + dompurify 打成 IIFE
 *   2. 包进一个自包含 HTML
 *   3. spawn 一个 Electron 进程（入口 scripts/test-dom-main.js）加载它
 *   4. Electron 把 window.__TEST_RESULTS__ 写回 JSON 文件
 *   5. 这里读 JSON、打印、按通过率决定退出码
 *
 * 用法：node scripts/test-dom.js [--filter 关键字]
 */
const path = require('path');
const fs = require('fs');
const util = require('util');
const { spawn } = require('child_process');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');
const SCRATCH = path.join(ROOT, '.cache', 'scratch');
const RESULT_FILE = path.join(SCRATCH, 'test-dom-result.json');
const BUNDLE = path.join(SCRATCH, 'test-dom-bundle.js');
const HTML = path.join(SCRATCH, 'test-dom.html');
// macOS 上 Electron 可执行文件在 .app 包内，Windows 才是 dist/electron.exe
const ELECTRON = process.platform === 'darwin'
  ? path.join(DEV, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
  : path.join(DEV, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = path.join(DEV, 'scripts', 'test-dom-main.js');

fs.mkdirSync(SCRATCH, { recursive: true });
for (const f of [RESULT_FILE, BUNDLE, HTML]) {
  try { fs.unlinkSync(f); } catch (e) {}
}

const filter = (() => {
  const i = process.argv.indexOf('--filter');
  return i > 0 ? process.argv[i + 1] : null;
})();

/* ---------- 1. esbuild 打包 ---------- */
// 用 Node API 而不是 shell 调 .bin/esbuild —— Windows 上 .bin/esbuild 是
// sh 脚本，execFileSync 直接调会失败。
log('打包测试代码...');
try {
  require('esbuild').buildSync({
    entryPoints: [path.join(DEV, 'tests', 'dom', 'main.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: BUNDLE,
    logLevel: 'warning'
  });
} catch (e) {
  log('X 打包失败: ' + (e.message || e));
  process.exit(1);
}

/* ---------- 2. 生成自包含 HTML ---------- */
const bundleCode = fs.readFileSync(BUNDLE, 'utf8');
fs.writeFileSync(HTML,
  '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><title>test</title></head>\n' +
  '<body><script>' + bundleCode + '</script></body></html>\n', 'utf8');

/* ---------- 3. spawn Electron ---------- */
log('启动 Electron 跑测试...\n');
// ELECTRON_RUN_AS_NODE 会让 electron.exe 退化成纯 node（require('electron') 返回空），
// 必须**彻底删掉**这个变量 —— 设成空串在 Windows 上仍算「已设置」。
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.NODE_OPTIONS;
childEnv.TEST_DOM_HTML = HTML;
childEnv.TEST_DOM_RESULT = RESULT_FILE;

// macOS 上从外层沙箱（CI / 终端嵌套环境）启动 Electron 时，其内置 seatbelt
// 会因权限不足初始化失败，加 --no-sandbox 放行；正常桌面环境不受影响
const SPAWN_ARGS = process.platform === 'darwin' ? ['--no-sandbox', MAIN] : [MAIN];

const child = spawn(ELECTRON, SPAWN_ARGS, {
  cwd: DEV,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: childEnv
});

const TIMEOUT = 120000;
const timer = setTimeout(() => {
  log('X 全局超时，杀掉 Electron');
  child.kill();
  process.exit(1);
}, TIMEOUT);
timer.unref();

child.on('exit', (code) => {
  clearTimeout(timer);
  if (!fs.existsSync(RESULT_FILE)) {
    log('X 没拿到结果文件');
    process.exit(1);
  }
  let out;
  try {
    out = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'));
  } catch (e) {
    log('X 结果文件解析失败: ' + e.message);
    process.exit(1);
  }

  let rows = out.results || [];
  if (filter) rows = rows.filter(r => r.name.includes(filter));

  for (const r of rows) {
    if (r.name.startsWith('──')) { console.log('\n' + r.name); continue; }
    if (r.pass) {
      console.log('  ✓ ' + r.name);
    } else {
      console.log('  ✗ ' + r.name);
      if (r.detail) console.log('      ' + String(r.detail).split('\n').join('\n      '));
    }
  }

  const shown = rows.filter(r => !r.name.startsWith('──'));
  const sp = shown.filter(r => r.pass).length;
  const sf = shown.filter(r => !r.pass).length;
  console.log('\n' + '='.repeat(60));
  console.log(`通过 ${sp} / ${sp + sf}` + (filter ? `  (筛选: ${filter})` : ''));
  if (sf) console.log(`失败 ${sf}`);
  process.exit(sf > 0 ? 1 : 0);
});
