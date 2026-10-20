#!/usr/bin/env node
/**
 * 纯 JS ZIP 解压器
 * Windows 自带 tar(libarchive) 拒绝 mac 应用的 zip（报 "This does not look like a tar archive"），
 * 故自行解析中央目录 + inflateRaw 解压，兼容符号链接与 Unix 权限位。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const util = require('util');

const log = (...a) => console.error(util.format(...a));

function extract(zipFile, destDir, filterName) {
  const b = fs.readFileSync(zipFile);

  // 定位 EOCD（可能有注释，从尾部反查）
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('未找到 EOCD: ' + zipFile);

  let count = b.readUInt16LE(eocd + 10);
  let cdOff = b.readUInt32LE(eocd + 16);

  // ZIP64：条目数超 65535 时走 ZIP64 扩展记录
  if (cdOff === 0xffffffff || count === 0xffff) {
    const locOff = b.readUInt32LE(eocd + 16 - 20); // EOCD 之前是 ZIP64 locator
    if (b.readUInt32LE(locOff) === 0x07064b50) {
      const z64 = Number(b.readBigUInt64LE(locOff + 8));
      count = Number(b.readBigUInt64LE(z64 + 32));
      cdOff = Number(b.readBigUInt64LE(z64 + 48));
    }
  }

  let p = cdOff;
  let extracted = 0, skipped = 0;
  const dirs = new Set();

  for (let k = 0; k < count; k++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) break;

    const flags      = b.readUInt16LE(p + 8);
    const method     = b.readUInt16LE(p + 10);
    const csize      = b.readUInt32LE(p + 20);
    const usize      = b.readUInt32LE(p + 24);
    const nl = b.readUInt16LE(p + 28);
    const el = b.readUInt16LE(p + 30);
    const cl = b.readUInt16LE(p + 32);
    const extAttr   = b.readUInt32LE(p + 38);
    const lho        = b.readUInt32LE(p + 42);

    const name = b.toString('utf8', p + 46, p + 46 + nl);

    // 只解需要的部分（Electron.app 其余不要）
    if (filterName && !filterName(name)) { skipped++; p += 46 + nl + el + cl; continue; }

    // Unix 权限高 16 位；0xA000 = 符号链接
    const unixMode = (extAttr >>> 16) & 0xffff;
    const isSymlink = (unixMode & 0xf000) === 0xa000;
    const isDir = name.endsWith('/');

    const outPath = path.join(destDir, ...name.split('/').filter(Boolean));

    if (isDir) {
      fs.mkdirSync(outPath, { recursive: true });
      dirs.add(outPath);
    } else {
      const parent = path.dirname(outPath);
      if (!dirs.has(parent)) { fs.mkdirSync(parent, { recursive: true }); dirs.add(parent); }

      // 读本地头拿真实数据起点
      const lnl = b.readUInt16LE(lho + 26);
      const lel = b.readUInt16LE(lho + 28);
      const dstart = lho + 30 + lnl + lel;
      const raw = b.slice(dstart, dstart + csize);

      let data;
      if (method === 0) data = raw;
      else if (method === 8) data = zlib.inflateRawSync(raw);
      else throw new Error('不支持的压缩方式 ' + method + ' (' + name + ')');

      if (isSymlink) {
        // Windows 无符号链接权限，但可以用 git 的 core.symlinks 模式——
        // 写一个「文本文件 + 标记」让上层知道这是链接。
        // 实际方案：本机用目录 junction 不行（需管理员），
        // 故存成普通文件 + .__symlink 标记，由 pack 阶段读回。
        const target = data.toString('utf8');
        fs.writeFileSync(outPath, target);
        fs.writeFileSync(outPath + '.__symlink', target);
      } else {
        fs.writeFileSync(outPath, data);
        // 保留 Unix 可执行位（用无扩展名的 shim 记录）
        if (unixMode & 0o111) {
          fs.writeFileSync(outPath + '.__x', String(unixMode & 0o777));
        }
      }
      extracted++;
    }
    p += 46 + nl + el + cl;
  }
  return { extracted, skipped };
}

module.exports = { extract };

if (require.main === module) {
  const [zip, dest, filter] = process.argv.slice(2);
  const r = extract(zip, dest, filter ? n => n.startsWith(filter) : null);
  log('解压 %s -> %s：写入 %d，跳过 %d', path.basename(zip), dest, r.extracted, r.skipped);
}
