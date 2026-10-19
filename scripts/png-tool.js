#!/usr/bin/env node
/**
 * PNG 工具：读尺寸 + 缩放 + 裁剪
 * Edge 在小窗口下不渲染，故统一按 128px 窗口渲染再缩放到目标尺寸。
 * 纯 Node 实现（无 sharp / 无 ImageMagick）。
 */
const fs = require('fs');
const zlib = require('zlib');

// ---------- CRC ----------
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
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// ---------- 解码 ----------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504E47) throw new Error('不是 PNG');
  let p = 8, w = 0, h = 0, bd = 8, ct = 6;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const typ = buf.toString('ascii', p + 4, p + 8);
    if (typ === 'IHDR') {
      w = buf.readUInt32BE(p + 8);
      h = buf.readUInt32BE(p + 12);
      bd = buf[p + 16];
      ct = buf[p + 17];
      if (buf[p + 20] !== 0) throw new Error('不支持隔行扫描');
    } else if (typ === 'IDAT') idat.push(buf.slice(p + 8, p + 8 + len));
    else if (typ === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('仅支持 8bit，实为 ' + bd);
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!bpp) throw new Error('不支持的颜色类型 ' + ct);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;

  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const cur = raw[pos + x];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = x >= bpp && y > 0 ? out[prevStart + x - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = cur; break;
        case 1: v = cur + a; break;
        case 2: v = cur + b; break;
        case 3: v = cur + ((a + b) >> 1); break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v = cur + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c));
          break;
        }
        default: v = cur;
      }
      out[rowStart + x] = v & 0xFF;
    }
    pos += stride;
  }
  return { w, h, bpp, ct, data: out };
}

// ---------- 编码 ----------
function encodePNG(w, h, bpp, ct, data) {
  const stride = w * bpp;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = ct;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 最近邻缩放到 target×target（图标场景下足够，且能保边缘锐利） */
function resize(img, tw, th) {
  const { w, h, bpp, ct, data } = img;
  const out = Buffer.alloc(tw * th * bpp);
  for (let y = 0; y < th; y++) {
    // 源图可能带透明边距（SVG viewBox 有留白），按中心区域取值
    const sy = Math.min(h - 1, Math.floor((y + 0.5) * h / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(w - 1, Math.floor((x + 0.5) * w / tw));
      const si = (sy * w + sx) * bpp;
      const di = (y * tw + x) * bpp;
      for (let k = 0; k < bpp; k++) out[di + k] = data[si + k];
    }
  }
  return encodePNG(tw, th, bpp, ct, out);
}

function sizeOf(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

module.exports = { decodePNG, encodePNG, resize, sizeOf };

if (require.main === module) {
  const [, , src, dst, sizeArg] = process.argv;
  if (!src || !dst) {
    console.error('用法: node png-tool.js <src.png> <dst.png> [尺寸]');
    process.exit(1);
  }
  const img = decodePNG(fs.readFileSync(src));
  if (!sizeArg) {
    console.log(`源尺寸: ${img.w} x ${img.h}, bpp=${img.bpp}, ct=${img.ct}`);
    process.exit(0);
  }
  const S = parseInt(sizeArg, 10);
  fs.writeFileSync(dst, resize(img, S, S));
  console.log(`${img.w}x${img.h} -> ${S}x${S}  ${fs.statSync(dst).size} B`);
}
