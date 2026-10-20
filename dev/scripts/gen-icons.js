#!/usr/bin/env node
/**
 * 从 SVG 生成应用图标全套
 *
 * 为什么自己写：环境里没有 Inkscape / ImageMagick / rsvg-convert，
 * 也没有 sharp。方案是用 Edge 无头渲染出 PNG，再手工封装 ICO 格式。
 *
 * ICO 格式（简化版，只存 PNG 帧）：
 *   ICONDIR(6) + ICONDIRENTRY×n(16 each) + PNG 数据
 *
 * 用法：node scripts/gen-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const util = require('util');
const { execFileSync, spawnSync } = require('child_process');

const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');
const OUT = path.join(DEV, 'build', 'icons');
const WORK = path.join(ROOT, '.cache', 'icons');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SVG = path.join(WORK, 'logo.svg');

// ICO 内嵌的尺寸（Windows 习惯：16/24/32/48/64/128/256）
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

/* ---------- 1. 用 Edge 渲染各尺寸 PNG ---------- */
function renderPng(size, dest) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
div{width:${size}px;height:${size}px}
svg{width:${size}px;height:${size}px;display:block}
</style></head><body><div>
${fs.readFileSync(SVG, 'utf-8').replace(/width="[^"]*"\s*height="[^"]*"/, '')}
</div></body></html>`;
  const tmpHtml = path.join(WORK, `r-${size}.html`);
  fs.writeFileSync(tmpHtml, html);

  // 用 spawnSync + 更大超时：execFileSync 的 120s 在此环境会 ETIMEDOUT
  const r = spawnSync(EDGE, [
    '--headless=new', '--disable-gpu',
    `--screenshot=${dest}`,
    `--window-size=${size},${size}`,
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--hide-scrollbars',
    `file:///${tmpHtml.replace(/\\/g, '/')}`
  ], { stdio: 'ignore', timeout: 300000, windowsHide: true });

  if (r.error) throw new Error('Edge 调用失败: ' + r.error.message);

  if (!fs.existsSync(dest)) throw new Error('渲染失败: ' + size);
  return fs.statSync(dest).size;
}

log('渲染 PNG...');
const pngs = {};
for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  const dest = path.join(WORK, `icon-${s}.png`);
  renderPng(s, dest);
  pngs[s] = dest;
  log('  %s x %s  %s KB', String(s).padStart(4), String(s).padStart(4),
      (fs.statSync(dest).size / 1024).toFixed(0));
}

/* ---------- 2. 封装 ICO（PNG 帧格式，Vista+ 通用） ---------- */
function buildIco(sizes, outPath) {
  const frames = sizes.map((s) => {
    const data = fs.readFileSync(path.join(WORK, `icon-${s}.png`));
    return { size: s, data };
  });

  // ICONDIR
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);          // reserved
  dir.writeUInt16LE(1, 2);          // type = 1 (icon)
  dir.writeUInt16LE(frames.length, 4);

  // ICONDIRENTRY 数组，长度 = 16 + 帧数据
  let offset = 6 + frames.length * 16;
  const entries = [];
  for (const f of frames) {
    const e = Buffer.alloc(16);
    e.writeUInt8(f.size >= 256 ? 0 : f.size, 0);   // width (0 = 256)
    e.writeUInt8(f.size >= 256 ? 0 : f.size, 1);   // height
    e.writeUInt8(0, 2);            // 调色板数
    e.writeUInt8(0, 3);            // reserved
    e.writeUInt16LE(1, 4);         // color planes
    e.writeUInt16LE(32, 6);        // bits per pixel
    e.writeUInt32LE(f.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += f.data.length;
    entries.push(e);
  }

  fs.writeFileSync(outPath, Buffer.concat([dir, ...entries, ...frames.map(f => f.data)]));
  return frames.length;
}

const icoPath = path.join(OUT, 'icon.ico');
const n = buildIco(ICO_SIZES, icoPath);
log('\nICO: %s  %s KB  (%d 个尺寸)', path.basename(icoPath),
    (fs.statSync(icoPath).size / 1024).toFixed(0), n);

/* ---------- 3. 复制常用PNG 到 build/icons ---------- */
for (const s of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  fs.copyFileSync(pngs[s], path.join(OUT, `icon-${s}.png`));
}
// 应用界面内嵌用的 base64 PNG（32px，深浅主题通用）
const b64 = fs.readFileSync(pngs[32]).toString('base64');
fs.writeFileSync(path.join(OUT, 'icon-32.base64.txt'), b64);

log('\n输出目录: %s', OUT);
for (const f of fs.readdirSync(OUT).sort()) {
  log('  %s', f);
}
