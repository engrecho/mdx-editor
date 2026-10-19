#!/usr/bin/env node
/**
 * 纯 JS ZIP 压缩器
 * 与 unzip.js 配套，绕开 Windows tar 对 mac 目录的兼容问题。
 * 用法：node zip.js <要压缩的目录或文件> <输出zip>
 * 输出保持传入的顶层名（如传入 MDX.app 则压缩包内为 MDX.app/...）。
 * Unix 权限位保留在外部属性高位，保证 mac 解压后 .app 可执行。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const util = require('util');

const log = (...a) => console.error(util.format(...a));

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function walk(root, base, out) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const fp = path.join(root, e.name);
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(fp, rel, out);
    else if (e.isFile()) out.push({ abs: fp, name: rel });
  }
}

function zipDir(srcDir, outZip) {
  const files = [];
  walk(srcDir, path.basename(srcDir), files);

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const comp = zlib.deflateRawSync(data, { level: 6 });
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);

    // .app 内的可执行文件与 framework 二进制需保留可执行位
    const isExec = /\/(MacOS\/[^/]+|[^/]+\.(dylib|so))$/.test(f.name) ||
                   /\/Electron Helper[^/]*$/.test(f.name) ||
                   /\/Frameworks\/[^/]+\/Versions\/[^/]+\/[^/]+$/.test(f.name);
    const mode = isExec ? 0o755 : 0o644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0x0800, 6);       // UTF-8 名称
    local.writeUInt16LE(8, 8);            // deflate
    local.writeUInt16LE(0, 10);           // time
    local.writeUInt16LE(0x21, 12);        // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE((mode << 16) >>> 0, 38); // 外部属性：Unix 权限
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + comp.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.writeFileSync(outZip, Buffer.concat([...chunks, cdBuf, eocd]));
  return files.length;
}

if (require.main === module) {
  const [src, out] = process.argv.slice(2);
  const n = zipDir(src, out);
  log('已压缩 %d 个文件 -> %s (%s MB)',
      n, path.basename(out), (fs.statSync(out).size / 1048576).toFixed(1));
}
