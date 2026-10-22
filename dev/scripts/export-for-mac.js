#!/usr/bin/env node
/**
 * 导出「在 Mac 上打包所需的最小文件集」成一个压缩包。
 *
 * 为什么需要这个：在 Mac 上打包不需要整个仓库（node_modules 有 461 个包、
 * 几百 MB，.cache/ 有构建产物），只需要 git 追踪的那 40 个源码文件。
 * 这个脚本把它们打成一个 tar.gz，拷到 Mac 解压就能用。
 *
 * 用法：
 *   node scripts/export-for-mac.js              # 导出到 .cache/scratch/
 *   node scripts/export-for-mac.js --out D:\tmp # 指定输出目录
 *
 * 产物：qingmo-mac-src-<version>.tar.gz
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const util = require('util');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');

// 输出版本号
const pkg = JSON.parse(fs.readFileSync(path.join(DEV, 'package.json'), 'utf-8'));
const VERSION = pkg.version;

const outArg = (() => {
  const i = process.argv.indexOf('--out');
  return i > 0 ? process.argv[i + 1] : null;
})();
const OUT_DIR = outArg ? path.resolve(outArg) : path.join(ROOT, '.cache', 'scratch');
const NAME = 'qingmo-mac-src-' + VERSION;
const TARBALL = path.join(OUT_DIR, NAME + '.tar.gz');

fs.mkdirSync(OUT_DIR, { recursive: true });
try { fs.unlinkSync(TARBALL); } catch (e) {}

log('导出最小文件集 v%s ...', VERSION);

// 用 git archive 导出 —— 这就是「Mac 上打包需要的全部」的权威答案：
// 所有被 git 追踪的文件，天然排除 node_modules / .cache / release / build-out*。
// 先落一个 .tar，解出来统计体积 + 校验关键文件，再压成 .tar.gz。
// 注意解到 TMP/NAME 子目录里 —— 这样最终 tar.gz 解压后会得到一个
// 名为 qingmo-mac-src-<版本> 的目录，Mac 上解压即用，不会散落文件。
const TMP = path.join(OUT_DIR, '.export-tmp');
const STAGE = path.join(TMP, NAME);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
fs.mkdirSync(STAGE, { recursive: true });

const TAR = path.join(OUT_DIR, NAME + '.tar');
try { fs.unlinkSync(TAR); } catch (e) {}
// 用 spawnSync 而非 execFileSync：execFileSync 配 stdio:'inherit' 时拿不到
// 错误详情，排查只能看到 "Command failed"。
const ar = spawnSync('git', ['archive', '--format=tar', '-o', TAR, 'HEAD'],
  { cwd: ROOT, encoding: 'utf8' });
if (ar.status !== 0) {
  log('X git archive 失败: %s', ar.stderr || ar.stdout || '(无输出)');
  process.exit(1);
}

// 注意：git archive 产出的是纯 .tar（未压缩），解压要用 -xf 而不是 -xzf
const un = spawnSync('tar', ['--force-local', '-xf', TAR, '-C', STAGE], { encoding: 'utf8' });
if (un.status !== 0) {
  log('X 解压失败: %s', un.stderr || '(无输出)');
  process.exit(1);
}

// 统计
let totalBytes = 0;
let fileCount = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    totalBytes += fs.statSync(p).size;
    fileCount++;
  }
};
walk(STAGE);

// 校验关键文件（缺任何一个 Mac 上都打不出包）
const REQUIRED = [
  'dev/package.json',
  'dev/package-lock.json',
  'dev/src/main/main.js',
  'dev/src/main/preload.js',
  'dev/src/renderer/app.js',
  'dev/src/renderer/live-edit.js',
  'dev/src/renderer/update.js',
  'dev/src/renderer/index.html',
  'dev/src/renderer/style.css',
  'dev/build/icons/icon.icns',
  'dev/build/icons/icon-256.png',
  'dev/pack-mac.sh',
  'dev/scripts/build-renderer.js',
  'dev/scripts/mac/build-mac.js',
  'dev/scripts/mac/fetch-runtime.js',
  'dev/scripts/pack.js'
];
const missing = REQUIRED.filter(f => !fs.existsSync(path.join(STAGE, f)));

log('\n解压后：%d 个文件，%s', fileCount, (totalBytes / 1024).toFixed(0) + ' KB');
if (missing.length) {
  log('X 缺少关键文件：');
  missing.forEach(f => log('    ' + f));
  process.exit(1);
}
log('关键文件校验：%d/%d 在位', REQUIRED.length - missing.length, REQUIRED.length);

// 打包成 tar.gz（Mac 原生支持 tar.gz，不需要额外软件）
// 压 TMP 的内容，解压后直接得到 dev/ docs/ README.md 等，不带外层目录名。
// 这样 Mac 上解压后 cd dev 就能用，不用再套一层。
const gz = spawnSync('tar', ['--force-local', '-czf', TARBALL, '-C', TMP, NAME],
  { encoding: 'utf8' });
if (gz.status !== 0) {
  log('X 压缩失败: %s', gz.stderr || '(无输出)');
  process.exit(1);
}

// 清理中间产物
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
try { fs.unlinkSync(TAR); } catch (e) {}

const sz = fs.statSync(TARBALL).size;
log('\n完成：%s', TARBALL);
log('体积：%s KB', (sz / 1024).toFixed(0));

log('\n接下来：');
log('  1. 把这个文件拷到 Mac（微信/邮件/U 盘/隔空投送都行）');
log('  2. Mac 上解压：');
log('       tar -xzf %s.tar.gz', NAME);
log('     会得到一个 %s/ 目录', NAME);
log('  3. 进入开发目录：        cd %s/dev', NAME);
log('  4. 一键打包：            ./pack-mac.sh');
log('     （或手动：npm install && npm run pack:mac）');
