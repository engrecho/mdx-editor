#!/usr/bin/env node
/**
 * 打包 ICO + 生成 macOS .icns / .iconset
 *
 * ICO 采用「PNG 帧」格式（Vista+ 通用），结构：
 *   ICONDIR(6) + ICONDIR_ENTRY(16)×n +各帧 PNG 数据
 *
 * .icns 同样内置 PNG 帧，类型码用 Apple 的 OSType。
 * 注意：真正的 .app 要在 mac 上跑 iconutil 才能被系统识别，
 * 这里生成的是合规的 icns 文件，可直接放进 Resources。
 *
 * 用法：node scripts/make-ico.js <PNG目录> <输出目录>
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', '..', '.cache', 'icons', 'final');
const OUT = process.argv[3] || path.join(__dirname, '..', 'build', 'icons');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

fs.mkdirSync(OUT, { recursive: true });

const png = {};
for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  const f = path.join(SRC, `icon-${s}.png`);
  if (fs.existsSync(f)) png[s] = fs.readFileSync(f);
}
if (!png[256]) {
  console.error('缺少 icon-256.png，无法生成 ICO');
  process.exit(1);
}

/* ================= ICO ================= */
function buildIco() {
  const sizes = ICO_SIZES.filter((s) => png[s]);
  const frames = sizes.map((s) => ({ size: s, data: png[s] }));

  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(frames.length, 4);

  let offset = 6 + frames.length * 16;
  const entries = frames.map((f) => {
    const e = Buffer.alloc(16);
    const d = f.size >= 256 ? 0 : f.size;
    e.writeUInt8(d, 0);
    e.writeUInt8(d, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(f.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += f.data.length;
    return e;
  });

  const buf = Buffer.concat([dir, ...entries, ...frames.map((f) => f.data)]);
  const out = path.join(OUT, 'icon.ico');
  fs.writeFileSync(out, buf);
  console.log(`ICO: icon.ico  ${(buf.length / 1024).toFixed(0)} KB  [${sizes.join(', ')}]`);
}

/* ================= ICNS ================= */
// Apple OSType → 该类型下支持的像素尺寸
const ICNS_TYPES = {
  'icp4': [16], 'icp5': [32], 'icp6': [64],
  'ic07': [128], 'ic08': [256], 'ic09': [512],
  'ic10': [1024], 'ic11': [32], 'ic12': [64], 'ic13': [256], 'ic14': [512]
};

function buildIcns() {
  const chunks = [];
  for (const [type, size] of Object.entries(ICNS_TYPES)) {
    if (!png[size]) continue;
    // ICNS 每块前置 8 字节：4 字节类型 + 4 字节长度（含这 8 字节）
    const data = png[size];
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(data.length + 8, 4);
    chunks.push(Buffer.concat([head, data]));
  }
  if (!chunks.length) {
    console.log('ICNS: 跳过（无可用尺寸）');
    return;
  }

  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  const buf = Buffer.concat([head, body]);

  const out = path.join(OUT, 'icon.icns');
  fs.writeFileSync(out, buf);
  console.log(`ICNS: icon.icns  ${(buf.length / 1024).toFixed(0)} KB  ${Object.keys(ICNS_TYPES).length} 种尺寸`);
}

/* ================= 输出 PNG ================= */
function copyPngs() {
  for (const s of Object.keys(png).map(Number).sort((a, b) => a - b)) {
    fs.writeFileSync(path.join(OUT, `icon-${s}.png`), png[s]);
  }
  // 应用内嵌用（base64，直接进 HTML）
  fs.writeFileSync(path.join(OUT, 'icon-64.base64.txt'), png[64].toString('base64'));
  console.log(`PNG: ${Object.keys(png).length} 个尺寸已输出`);
}

buildIco();
buildIcns();
copyPngs();
console.log(`\n输出目录: ${OUT}`);
