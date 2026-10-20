#!/usr/bin/env node
/**
 * macOS .app 组装（保留原始 zip 结构）
 *
 * 为什么不用「解压 → 改 → 重压」：
 *   1. mac 的 Electron 框架有 14 个符号链接（Versions/Current -> A 等），
 *      Windows 无法创建符号链接，解压后必然丢失
 *   2. 链接目标必须保持相对路径，转绝对路径会导致 mac 加载框架失败
 *   3. 官方包有 145 个目录条目，缺失会导致目录结构不完整
 *   换句话说，Windows 上「解压再压缩」不可能产出可用的 .app。
 *   （早期版本正是因此产出「应用已损坏」的包）
 *
 * 正确方案：**直接改官方 zip 里的条目**：
 *   - Electron.app → QingMo.app
 *   - 替换 app.asar
 *   - 改 Info.plist
 *   - 删掉 default_app.asar
 *   - 加 icon.icns
 *   其余条目（目录、链接、权限位、压缩数据）原样复制
 *
 * 用法：node scripts/mac/build-mac.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const util = require('util');
const { execFileSync } = require('child_process');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..', '..');
const ROOT = path.join(DEV, '..');   // 仓库根
const CACHE = path.join(ROOT, '.cache', 'electron-mac');
const TMP = path.join(ROOT, '.cache', 'mac-build');
const OUT = path.join(ROOT, 'build-out-121', 'mac');
const ARCHES = ['arm64', 'x64'];

// @electron/asar 是 ESM-only，唯一可靠入口是 CLI
const ASAR_CLI = path.join(DEV, 'node_modules', '@electron', 'asar', 'bin', 'asar.mjs');
const NODE_BIN = process.execPath;

const pkg = JSON.parse(fs.readFileSync(path.join(DEV, 'package.json'), 'utf-8'));
const APP_CN = '轻墨';
const BIN_NAME = 'QingMo';
const BUNDLE_ID = 'cn.bajiaolu.qingmo';

/* ============================================================
   ZIP 读写
   ============================================================ */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function readEntries(file) {
  const b = fs.readFileSync(file);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('未找到 EOCD: ' + file);

  let count = b.readUInt16LE(eocd + 10);
  let cdOff = b.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff || count === 0xffff) {
    const locOff = b.readUInt32LE(eocd - 4);
    if (b.readUInt32LE(locOff) === 0x07064b50) {
      const z64 = Number(b.readBigUInt64LE(locOff + 8));
      count = Number(b.readBigUInt64LE(z64 + 32));
      cdOff = Number(b.readBigUInt64LE(z64 + 48));
    }
  }

  const entries = [];
  let p = cdOff;
  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) break;
    const nl = b.readUInt16LE(p + 28);
    const el = b.readUInt16LE(p + 30);
    const cl = b.readUInt16LE(p + 32);
    entries.push({
      name: b.toString('utf8', p + 46, p + 46 + nl),
      method: b.readUInt16LE(p + 10),
      csize: b.readUInt32LE(p + 20),
      usize: b.readUInt32LE(p + 24),
      extAttr: b.readUInt32LE(p + 38),
      lho: b.readUInt32LE(p + 42),
      time: b.readUInt16LE(p + 10),
      date: b.readUInt16LE(p + 12)
    });
    p += 46 + nl + el + cl;
  }
  return { buf: b, entries };
}

function entryData(buf, ent) {
  const lnl = buf.readUInt16LE(ent.lho + 26);
  const lel = buf.readUInt16LE(ent.lho + 28);
  const ds = ent.lho + 30 + lnl + lel;
  const raw = buf.slice(ds, ds + ent.csize);
  return ent.method === 0 ? raw : zlib.inflateRawSync(raw);
}

/**
 * 构造新 zip：逐条复制，需要的条目替换
 * transform(name, isDir) 返回 null=原样复制 / {skip} / {rename} / {data}
 */
function writeZip(srcFile, outFile, transform) {
  const { buf, entries } = readEntries(srcFile);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const ent of entries) {
    const isDir = ent.name.endsWith('/');
    const t = transform(ent.name, isDir, ent) || {};
    if (t.skip) continue;

    const name = t.rename || ent.name;
    const nameBuf = Buffer.from(name, 'utf-8');
    let method = ent.method;
    let mode = (ent.extAttr >>> 16) & 0xffff;
    let crc, comp, usize;

    if (t.data) {
      // 替换内容：重新压缩
      method = 8;
      usize = t.data.length;
      crc = crc32(t.data);
      comp = zlib.deflateRawSync(t.data, { level: 6 });
      if (mode === 0) mode = 0o644;
    } else {
      // 原样复制：连压缩数据一起搬，保留 method / 链接 / 权限位
      const lnl = buf.readUInt16LE(ent.lho + 26);
      const lel = buf.readUInt16LE(ent.lho + 28);
      const ds = ent.lho + 30 + lnl + lel;
      comp = buf.slice(ds, ds + ent.csize);
      crc = buf.readUInt32LE(ent.lho + 14);
      usize = ent.usize;
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(ent.time, 10);
    local.writeUInt16LE(ent.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(usize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(ent.time, 12);
    cd.writeUInt16LE(ent.date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(usize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE((mode << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat([...chunks, cdBuf, eocd]));
  return central.length;
}

/* ============================================================
   准备 app.asar
   ============================================================ */
function buildAsar() {
  const STAMP = String(process.hrtime.bigint()).slice(-9);
  const stage = path.join(TMP, 'stage-' + STAMP);
  fs.mkdirSync(stage, { recursive: true });

  // 手写递归拷贝：fs.cpSync 在中文路径下会崩进程（0xC0000409）
  function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      if (e.name.startsWith('_')) continue;    // 排除走查临时文件
      const s = path.join(src, e.name);
      const d = path.join(dst, e.name);
      if (e.isDirectory()) copyDir(s, d);
      else if (e.isFile()) fs.copyFileSync(s, d);
    }
  }
  copyDir(path.join(DEV, 'src'), path.join(stage, 'resources'));

  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: 'qingmo',
    productName: APP_CN,
    version: pkg.version,
    description: pkg.description,
    author: pkg.author,
    license: pkg.license,
    main: pkg.main
  }, null, 2));

  const asar = path.join(stage, 'app.asar');
  execFileSync(NODE_BIN, [ASAR_CLI, 'pack', stage, asar],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 512 });
  if (!fs.existsSync(asar)) throw new Error('asar 打包未产出');
  return asar;
}

/* ============================================================
   组装
   ============================================================ */
const asarPath = buildAsar();
const asarData = fs.readFileSync(asarPath);
log('app.asar: %s KB', (asarData.length / 1024).toFixed(0));

const icnsPath = path.join(DEV, 'build', 'icons', 'icon.icns');
const icns = fs.existsSync(icnsPath) ? fs.readFileSync(icnsPath) : null;
if (icns) log('icon.icns: %s KB', (icns.length / 1024).toFixed(0));

for (const arch of ARCHES) {
  log('\n=== [%s] ===', arch);
  const srcZip = path.join(CACHE, `electron-darwin-${arch}.zip`);
  if (!fs.existsSync(srcZip)) { log('X 缺少 %s', srcZip); continue; }

  const { buf, entries } = readEntries(srcZip);
  const outZip = path.join(OUT, `QingMo-${pkg.version}-mac-${arch}.zip`);

  const n = writeZip(srcZip, outZip, (name, isDir, ent) => {
    // 顺序很重要：先处理需要替换内容的条目（基于原始名匹配），
    // 再做 Electron.app → QingMo.app 的整体改名。
    // 若先改名，后续 endsWith 匹配会全部落空。

    // 官方包里没有 app.asar，只有 default_app.asar —— 用它当占位替换掉
    if (name.endsWith('/Contents/Resources/default_app.asar')) {
      return { rename: 'QingMo.app/Contents/Resources/app.asar', data: asarData };
    }
    if (name.endsWith('/Contents/Resources/electron.asar')) return { skip: true };

    // 官方图标是 electron.icns，替换成我们的 icon.icns
    if (name.endsWith('/Contents/Resources/electron.icns')) {
      return { rename: 'QingMo.app/Contents/Resources/icon.icns', data: icns };
    }

    // 可执行文件改名：MacOS/Electron → MacOS/QingMo
    // 必须与 Info.plist 的 CFBundleExecutable 一致
    if (name.endsWith('/Contents/MacOS/Electron')) {
      return { rename: 'QingMo.app/Contents/MacOS/' + BIN_NAME };
    }

    // Electron.app → QingMo.app
    if (name === 'Electron.app/') return { rename: 'QingMo.app/' };
    if (name.startsWith('Electron.app/')) {
      return { rename: 'QingMo.app/' + name.slice('Electron.app/'.length) };
    }

    // 改 Info.plist
    if (name.endsWith('/Contents/Info.plist')) {
      let plist = entryData(buf, ent).toString('utf-8');
      const setKey = (key, val) => {
        const re = new RegExp('(<key>' + key + '</key>\\s*<string>)[^<]*(</string>)');
        if (re.test(plist)) { plist = plist.replace(re, '$1' + val + '$2'); return true; }
        return false;
      };
      setKey('CFBundleName', APP_CN);
      setKey('CFBundleDisplayName', APP_CN);
      setKey('CFBundleExecutable', BIN_NAME);
      setKey('CFBundleIdentifier', BUNDLE_ID);
      setKey('CFBundleShortVersionString', pkg.version);
      setKey('CFBundleVersion', pkg.version);
      setKey('CFBundleGetInfoString', pkg.description);
      setKey('LSApplicationCategoryType', 'public.app-category.productivity');
      if (!/CFBundleIconFile/.test(plist)) {
        plist = plist.replace('</dict>',
          '\t<key>CFBundleIconFile</key>\n\t<string>icon.icns</string>\n</dict>');
      }
      return { data: Buffer.from(plist, 'utf-8') };
    }

    return null;  // 原样复制
  });

  log('OK %s  %s MB  (%d 条目)',
      path.basename(outZip), (fs.statSync(outZip).size / 1048576).toFixed(1), n);
}

log('\n完成 -> %s', path.relative(ROOT, OUT) + '/');
