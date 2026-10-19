#!/usr/bin/env node
/**
 * 跨平台组装 macOS .app
 *
 * 为什么不用 electron-builder：它硬性禁止在 Windows 上打 mac 包
 * （"Build for macOS is supported only on macOS"），.dmg 更是必须 macOS 的 hdiutil。
 * 野路子可行：取官方 Electron mac 运行时 → 注入 app.asar → 改 Info.plist → 压 zip。
 *
 * 为什么不用系统 tar：Windows 自带 tar(libarchive) 拒绝 mac 应用的 zip，
 * 报 "This does not look like a tar archive"，故用 unzip.js 纯 JS 解压。
 *
 * 产物在 mac 上首次需右键打开（未签名）。
 */
const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFileSync } = require('child_process');
const { extract } = require('./unzip.js');

const log = (...a) => console.error(util.format(...a));

const SRC = path.join(__dirname, '..', '..');
// 运行时缓存（npm run mac:fetch 下载到这）与临时工作区，都收进项目内 .cache/
const CACHE = path.join(SRC, '.cache', 'electron-mac');
const TMP = path.join(SRC, '.cache', 'mac-build');
const ARCHES = ['arm64', 'x64'];

// @electron/asar 是 ESM-only，CJS 的 createPackageWithOptions 在此版本静默不产出，
// 唯一可靠入口是 CLI
const NODE_BIN = process.execPath;
const ASAR_CLI = path.join(SRC, 'node_modules', '@electron', 'asar', 'bin', 'asar.mjs');
if (!fs.existsSync(ASAR_CLI)) { log('X 未找到 asar CLI: %s', ASAR_CLI); process.exit(1); }
const asarCreate = (src, dest) => {
  execFileSync(NODE_BIN, [ASAR_CLI, 'pack', src, dest],
    { cwd: TMP, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 512 });
  if (!fs.existsSync(dest)) throw new Error('asar 打包未产出: ' + dest);
};

/* ---------- 1. 应用资源暂存 ---------- */
const STAMP = String(process.hrtime.bigint()).slice(-9);
const appStage = path.join(TMP, 'stage-' + STAMP);
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(appStage, { recursive: true });

// 手写递归拷贝：fs.cpSync 在此 Node 构建 + 中文路径下会触发
// 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN) 进程强杀。顺手排除
// 下划线开头的走查临时文件，避免进 asar。
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name.startsWith('_')) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}
copyDir(path.join(SRC, 'src'), path.join(appStage, 'resources'));

const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf-8'));
fs.writeFileSync(path.join(appStage, 'package.json'), JSON.stringify({
  name: 'mdx-editor',
  productName: 'MDX',
  version: pkg.version,
  description: pkg.description,
  author: pkg.author,
  license: pkg.license,
  main: pkg.main
}, null, 2));

log('OK 资源暂存于 %s', path.basename(appStage));

/* ---------- 2. 逐架构组装 ---------- */
const outDir = path.join(SRC, 'build-output', 'mac');
fs.mkdirSync(outDir, { recursive: true });

for (const arch of ARCHES) {
  log('\n=== [%s] ===', arch);

  const zip = path.join(CACHE, 'electron-darwin-' + arch + '.zip');
  if (!fs.existsSync(zip)) { log('X 缺少 %s', zip); continue; }

  const work = path.join(TMP, 'w-' + arch + '-' + STAMP);
  fs.mkdirSync(work, { recursive: true });

  log('解压运行时（纯 JS，绕开系统 tar）...');
  const r = extract(zip, work);
  log('  写入 %d 项', r.extracted);

  const entries = fs.readdirSync(work);
  const appName = entries.find(d => d.endsWith('.app'));
  if (!appName) { log('X 未找到 .app: %s', entries.join(',')); continue; }

  const srcApp = path.join(work, appName);
  // .app 目录名与可执行文件名用 ASCII「QingMo」——mac 惯例，且避免非 ASCII
  // 名在部分系统调用下的兼容问题。用户可见的名称走 Info.plist 里的中文。
  const APP_DIR = 'QingMo.app';
  const BIN_NAME = 'QingMo';
  const newApp = path.join(work, APP_DIR);
  if (appName !== APP_DIR) fs.renameSync(srcApp, newApp);

  const macRes = path.join(newApp, 'Contents', 'Resources');
  const macBin = path.join(newApp, 'Contents', 'MacOS');

  // 清掉官方默认 asar
  for (const f of ['default_app.asar', 'app.asar', 'electron.asar']) {
    try { fs.unlinkSync(path.join(macRes, f)); } catch (e) {}
  }

  log('注入 app.asar...');
  asarCreate(appStage, path.join(macRes, 'app.asar'));
  log('  app.asar = %s KB', (fs.statSync(path.join(macRes, 'app.asar')).size / 1024).toFixed(0));

  // 改可执行文件名
  const bins = fs.readdirSync(macBin).filter(f => !f.endsWith('.__x'));
  if (!bins.includes(BIN_NAME) && bins.length) {
    fs.renameSync(path.join(macBin, bins[0]), path.join(macBin, BIN_NAME));
    log('  可执行: %s -> %s', bins[0], BIN_NAME);
  }

  // 改 Info.plist：内部标识用 ASCII，用户可见名用中文
  const plistPath = path.join(newApp, 'Contents', 'Info.plist');
  let plist = fs.readFileSync(plistPath, 'utf-8');
  let changed = 0;
  const setKey = (key, val) => {
    const re = new RegExp('(<key>' + key + '</key>\\s*<string>)[^<]*(</string>)');
    if (re.test(plist)) { plist = plist.replace(re, '$1' + val + '$2'); changed++; }
  };
  const APP_CN = '轻墨';
  setKey('CFBundleName', APP_CN);                    // 菜单栏 / 默认显示
  setKey('CFBundleDisplayName', APP_CN);             // 访达显示名
  setKey('CFBundleExecutable', BIN_NAME);            // 必须与实际可执行文件名一致
  setKey('CFBundleIdentifier', 'cn.bajiaolu.qingmo');
  setKey('CFBundleShortVersionString', pkg.version);
  setKey('CFBundleVersion', pkg.version);
  setKey('CFBundleGetInfoString', pkg.description);
  setKey('LSApplicationCategoryType', 'public.app-category.productivity');
  fs.writeFileSync(plistPath, plist);
  log('  Info.plist 更新 %d 项', changed);

  // 清除解压器的辅助标记（__x / __symlink）——mac 侧不需要
  const cleanMarks = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) cleanMarks(fp);
      else if (e.name.endsWith('.__x')) fs.unlinkSync(fp);
    }
  };
  cleanMarks(newApp);
  log('  已清理权限标记');

  // 压缩
  // 产物文件名用 ASCII，避免跨平台传输时中文文件名带来的兼容问题
  const outZip = path.join(outDir, `QingMo-${pkg.version}-mac-${arch}.zip`);
  try { fs.unlinkSync(outZip); } catch (e) {}
  // 注入应用图标：.icns 放到 Resources，并在 Info.plist 里声明
  const icns = path.join(SRC, 'build', 'icons', 'icon.icns');
  if (fs.existsSync(icns)) {
    fs.copyFileSync(icns, path.join(macRes, 'icon.icns'));
    let p2 = fs.readFileSync(plistPath, 'utf-8');
    if (!p2.includes('CFBundleIconFile')) {
      p2 = p2.replace('</dict>',
        '\t<key>CFBundleIconFile</key>\n\t<string>icon.icns</string>\n</dict>');
      fs.writeFileSync(plistPath, p2);
    }
    log('  已注入 icon.icns');
  }

  log('压缩打包...');
  execFileSync(NODE_BIN, [path.join(__dirname, 'zip.js'), newApp, outZip],
    { cwd: TMP, stdio: ['inherit', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 512 });

  log('OK %s  %s MB', path.basename(outZip),
      (fs.statSync(outZip).size / 1048576).toFixed(1));
}

log('\n完成 -> mdx-editor/release-v2/mac/');
