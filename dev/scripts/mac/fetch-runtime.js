#!/usr/bin/env node
/**
 * 下载 Electron mac 运行时（两个架构）
 * GitHub release 直连会 302 失败，走 npmmirror 国内镜像。
 * 用法：node scripts/mac/fetch-runtime.js [版本号]
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFileSync } = require('child_process');

const log = (...a) => console.error(util.format(...a));

const VER = process.argv[2] ||
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'))
    .devDependencies.electron.replace(/[\^~]/g, '');
// 运行时缓存放在项目内 .cache/，已 gitignore
// 删掉后重新执行 npm run mac:fetch 即可再下载
const CACHE = path.join(__dirname, '..', '..', '..', '.cache', 'electron-mac');
const ARCHES = ['arm64', 'x64'];
const MIRRORS = [
  'https://npmmirror.com/mirrors/electron/',
  'https://cdn.npmmirror.com/binaries/electron/'
];

fs.mkdirSync(CACHE, { recursive: true });

for (const arch of ARCHES) {
  const file = path.join(CACHE, `electron-darwin-${arch}.zip`);
  if (fs.existsSync(file) && fs.statSync(file).size > 50 * 1024 * 1024) {
    log('已存在 %s (%.1f MB)', path.basename(file), fs.statSync(file).size / 1048576);
    continue;
  }
  const name = `electron-v${VER}-darwin-${arch}.zip`;
  let ok = false;
  for (const m of MIRRORS) {
    log('下载 %s ...', m + name);
    try {
      execFileSync('curl', ['-sL', '--max-time', '600', '-o', file, m + name],
        { stdio: 'inherit', timeout: 660000 });
      const sz = fs.statSync(file).size;
      if (sz > 50 * 1024 * 1024) {
        log('OK %s (%.1f MB)', path.basename(file), sz / 1048576);
        ok = true;
        break;
      }
      log('  文件过小 (%d 字节)，换源', sz);
    } catch (e) {
      log('  失败: %s', e.message);
    }
  }
  if (!ok) log('X %s 下载失败', name);
}

log('\n运行时缓存目录: %s', CACHE);
