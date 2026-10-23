#!/usr/bin/env node
/**
 * 文件关联集成测试（真实主进程 + 真实 argv 路径）
 *
 * 覆盖 src/main/main.js 里的 openPathInApp：文件路径进来后要被投给
 * 渲染层（cmd:openPath），同时进「最近打开」列表。这里不去合成
 * open-file 事件（那会打到Electron 原生层，进程直接崩），而是走
 * 命令行传参这条真实路径，再读 userData/recent.json 断言结果 ——
 * pushRecent 是这条链路上必然经过的一步。
 *
 * macOS 的 open-file 事件路径与 argv 路径共用 openPathInApp，
 * 且真正的双击验证由打包后 `open -a轻墨.app x.md` 走LaunchServices 完成。
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/test-file-association.js /tmp/xxx.md
 */
if (!process.versions.electron) {
  console.error('用法：npx electron --no-sandbox --disable-gpu scripts/test-file-association.js <要打开的.md>');
  process.exit(1);
}

const path = require('path');
const fs = require('fs');
const DEV = path.join(__dirname, '..');
const target = process.argv.slice(2).find(p => /\.(md|markdown|mdown|mkd)$/i.test(p));

if (!target || !fs.existsSync(target)) {
  console.error('用法：npx electron scripts/test-file-association.js <要打开的.md>');
  process.exit(1);
}

// 加载真实主进程（它会注册 open-file / argv 处理并创建窗口）
require(path.join(DEV, 'src', 'main', 'main.js'));

const { app } = require('electron');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const recentFile = path.join(app.getPath('userData'), 'recent.json');
  let recent = [];

  // 等「文件被投给渲染层 → 渲染层回调 fs:openPath → 主进程写 recent.json」
  // 这条链路走完。
  //
  // 这里用轮询而不是固定 sleep：冷启动时首屏渲染可能超过 2 秒
  // （比如刚重建完 bundle），写死等待会偶发假失败。
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await wait(300);
    try { recent = JSON.parse(fs.readFileSync(recentFile, 'utf-8')) || []; } catch (e) {}
    if (recent.includes(path.resolve(target)) || recent.includes(target)) break;
  }

  const opened = recent.includes(path.resolve(target)) || recent.includes(target);
  console.log((opened ? '  PASS ' : '  FAIL ') + '命令行传入的 .md 进入最近打开列表');
  if (!opened) {
    console.log('        目标: ' + target);
    console.log('        recent.json: ' + JSON.stringify(recent));
  }

  // 顺带确认窗口确实起来了、渲染层有内容
  const win = require('electron').BrowserWindow.getAllWindows()[0];
  const alive = !!(win && !win.isDestroyed());
  console.log((alive ? '  PASS ' : '  FAIL ') + '主窗口已创建');

  const pass = (opened ? 1 : 0) + (alive ? 1 : 0);
  console.log('\n' + (pass === 2 ? 'OK' : 'FAIL') + ': ' + pass + ' / 2');
  app.exit(pass === 2 ? 0 : 1);
}).catch(e => { console.error('ERR: ' + (e.stack || e.message)); app.exit(1); });