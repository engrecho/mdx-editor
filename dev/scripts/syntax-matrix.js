#!/usr/bin/env node
/**
 * 语法上下文 × 操作 矩阵 —— 探索版
 *
 * 跑一遍记录【实际行为】，输出供人工判断哪些是 bug。
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/syntax-matrix.js
 */
if (!process.versions.electron) {
  console.error('用 electron 跑');
  process.exit(1);
}

const path = require('path');
const fs = require('fs');
const util = require('util');
const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(DEV, 'src', 'main', 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  await win.loadFile(path.join(DEV, 'src', 'renderer', 'index.html'), { query: { test: '1' } });
  await new Promise(r => setTimeout(r, 900));

  const { CONTEXTS, COMMANDS, INTEGRITY, ANCHORS } =
    require(path.join(DEV, 'tests', 'syntax', 'contexts.js'));
  // 页面里跑的那段（IIFE），单独放文件避免模板字符串转义问题。
  // 结尾的分号必须去掉 —— 拼成 (function(){...};)(args) 是语法错误。
  const runnerSrc = fs.readFileSync(path.join(DEV, 'tests', 'syntax', 'run-matrix.js'), 'utf8')
    .trim().replace(/;\s*$/, '');
  const pageScript = `(function(){
    try {
      return (${runnerSrc})(${JSON.stringify(CONTEXTS)},${JSON.stringify(COMMANDS)},${JSON.stringify(INTEGRITY)},${JSON.stringify(ANCHORS)});
    } catch (e) {
      window.__lastError = (e && e.stack) || String(e);
      throw e;
    }
  })()`;

  let rows = [];
  try {
    rows = await win.webContents.executeJavaScript(pageScript, true);
  } catch (e) {
    log('X 页面脚本失败: ' + (e && e.message));
    try {
      const detail = await win.webContents.executeJavaScript(
        'String(window.__lastError || "(无 __lastError)")', true);
      log('  页面侧: ' + detail);
    } catch (e2) { /* 忽略 */ }
    setTimeout(() => app.exit(1), 100);
    return;
  }

  const bad = r => r.err || r.missingHead.length || r.missingCnt.length || r.split;
  const problems = rows.filter(bad);

  log('\n共 %d 组，%d 组有问题\n', rows.length, problems.length);

  // 按「问题类型」汇总，一眼看出哪些是系统性问题
  const byCmd = {}, byCtx = {}, byKind = { err: 0, head: 0, cnt: 0, split: 0 };
  for (const r of problems) {
    byCmd[r.cmd] = (byCmd[r.cmd] || 0) + 1;
    byCtx[r.ctx] = (byCtx[r.ctx] || 0) + 1;
    if (r.err) byKind.err++;
    if (r.missingHead.length) byKind.head++;
    if (r.missingCnt.length) byKind.cnt++;
    if (r.split) byKind.split++;
  }
  log('按命令（问题数）:');
  Object.entries(byCmd).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => log('   ' + k.padEnd(14) + v));
  log('按上下文（问题数）:');
  Object.entries(byCtx).sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => log('   ' + k.padEnd(14) + v));
  log('按类型: 异常' + byKind.err + ' / 丢标记' + byKind.head +
    ' / 丢内容' + byKind.cnt + ' / 段落劈开' + byKind.split);

  // 逐条明细
  log('\n---- 明细 ----');
  let cur = '';
  for (const r of rows) {
    if (!bad(r)) continue;
    if (r.ctx !== cur) {
      cur = r.ctx;
      const c0 = CONTEXTS.find(x => x.id === cur);
      log('\n== ' + c0.name + '  [' + c0.ctx + ']  ' + JSON.stringify(c0.doc));
    }
    const flags = [];
    if (r.err) flags.push('异常:' + r.err);
    if (r.missingHead.length) flags.push('丢标记:' + r.missingHead.join(','));
    if (r.missingCnt.length) flags.push('丢内容:' + r.missingCnt.join(','));
    if (r.split) flags.push('段落被劈开');
    log('  x ' + r.cmd.padEnd(13) + flags.join(' | '));
    log('      -> ' + JSON.stringify(r.doc));
  }

  const outDir = path.join(DEV, '..', '.cache', 'scratch');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'syntax-matrix.json'), JSON.stringify(rows, null, 2), 'utf8');
  log('\n原始数据: .cache/scratch/syntax-matrix.json');

  setTimeout(() => app.exit(0), 200);
});
