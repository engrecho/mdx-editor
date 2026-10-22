#!/usr/bin/env node
/**
 * 从一张源图生成应用图标全套 + 注入界面
 *
 * 为什么需要这个：环境里没有 ImageMagick / sharp / Inkscape，svg 渲染那条
 * 路（scripts/gen-icons.js）只在 Windows + Edge 下能跑。用 Electron 自带的
 * Chromium canvas 做像素处理，跨平台都能跑，且每次换 LOGO 都能复用。
 *
 * 用法（必须用 electron 跑，canvas 在主进程里）：
 *   npx electron scripts/gen-logo-icons.js --src ~/Desktop/logo.png
 *   （在受限沙箱里跑要加 --no-sandbox --disable-gpu，否则 Chromium 起不来）
 *
 * 可调参数：
 *   --src <path>     源图（必填）。PNG 透明底黑形最省事，不透明白底也能抠
 *   --pad 0.03       内容裁剪时四周留白比例，越小图形越饱满
 *   --ratio 0.8      图形在squircle 里的占比，越大越满（macOS 惯用 0.75~0.85）
 *   --titlebar 14    标题栏 img 的显示尺寸（CSS 和 HTML 属性都要跟着改）
 *   --about 52       关于弹窗 img 的显示尺寸
 *
 * 产出：
 *   .cache/icons/final/icon-{16,24,32,48,64,128,256,512,1024}.png  （喂 make-ico.js）
 *   index.html 标题栏 img、update.js 关于弹窗 img 的 data URI（幂等，可重复跑）
 *
 * 跑完接着跑：node scripts/make-ico.js
 */
if (!process.versions.electron) {
  console.error('这个脚本要用 electron 跑（要用 Chromium canvas）：');
  console.error('  npx electron scripts/gen-logo-icons.js --src <源图路径>');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const util = require('util');

const log = (...a) => console.error(util.format(...a));
const DEV = path.join(__dirname, '..');
const ROOT = path.join(DEV, '..');
const FINAL = path.join(ROOT, '.cache', 'icons', 'final');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : def;
}

const SRC = arg('src', '');
const PAD = parseFloat(arg('pad', '0.03'));
const RATIO = parseFloat(arg('ratio', '0.8'));
const TITLEBAR = parseInt(arg('titlebar', '14'), 10);
const ABOUT = parseInt(arg('about', '52'), 10);

if (!SRC || !fs.existsSync(SRC)) {
  log('X 找不到源图：%s', SRC || '(没给 --src)');
  process.exit(1);
}

const { app, BrowserWindow } = require('electron');
const srcB64 = fs.readFileSync(SRC).toString('base64');
const srcMime = /\.png$/i.test(SRC) ? 'image/png' : /\.webp$/i.test(SRC) ? 'image/webp' : 'image/jpeg';

app.whenReady().then(async () => {
  fs.mkdirSync(FINAL, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 400, height: 300 });
  await new Promise(res => {
    win.webContents.once('did-finish-load', res);
    win.loadURL('about:blank');
  });

  const out = await win.webContents.executeJavaScript(`
    (async () => {
      const img = new Image();
      img.src = 'data:${srcMime};base64,${srcB64}';
      await img.decode();
      const W = img.naturalWidth, H = img.naturalHeight;

      /* ---- 1. 取 alpha：源图自带透明底就直接用；不透明白底才抠 ---- */
      const src = document.createElement('canvas');
      src.width = W; src.height = H;
      const sctx = src.getContext('2d');
      sctx.drawImage(img, 0, 0);
      const sd = sctx.getImageData(0, 0, W, H);
      const d = sd.data;

      let hasAlpha = false;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] < 250) { hasAlpha = true; break; }
      }
      if (!hasAlpha) {
        // 白底抠透明：软阈值，保边缘抗锯齿
        const KNEE = 235, GAIN = 2.4;
        for (let i = 0; i < d.length; i += 4) {
          const m = Math.min(d[i], d[i + 1], d[i + 2]);
          d[i + 3] = m >= KNEE ? 0 : Math.min(255, (KNEE - m) * GAIN);
        }
      }

      // 内容包围盒
      let minX = W, minY = H, maxX = -1, maxY = -1;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 24) {
          const p = i / 4;
          const x = p % W, y = (p - x) / W;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      sctx.putImageData(sd, 0, 0);

      /* ---- 2. 裁剪到内容（留少量呼吸边距，留太多小图标会显得空）---- */
      const pad = Math.round(Math.max(maxX - minX, maxY - minY) * ${PAD});
      const cw = Math.min(W, maxX - minX + 1 + pad * 2);
      const ch = Math.min(H, maxY - minY + 1 + pad * 2);
      const cx = Math.max(0, minX - pad), cy = Math.max(0, minY - pad);
      const crop = document.createElement('canvas');
      crop.width = cw; crop.height = ch;
      crop.getContext('2d').drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);

      /* ---- 3. 掩膜：降采样 + alpha 增强（+ 可选膨胀）---- */
      function makeMask(w, boost, dilateR) {
        const c = document.createElement('canvas');
        c.width = w; c.height = Math.round(ch * w / cw);
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = 'high';
        x.drawImage(crop, 0, 0, c.width, c.height);
        const id = x.getImageData(0, 0, c.width, c.height);
        const dd = id.data;
        if (boost !== 1) {
          for (let i = 3; i < dd.length; i += 4) dd[i] = Math.min(255, dd[i] * boost);
        }
        if (dilateR > 0) {
          // 可分离开塞最大值滤波，只动 alpha，RGB 保持原样
          const w2 = c.width, h2 = c.height;
          const tmp = new Uint8ClampedArray(dd.length);
          for (let y = 0; y < h2; y++) {
            for (let xx = 0; xx < w2; xx++) {
              let m = 0;
              for (let k = -dilateR; k <= dilateR; k++) {
                const xxx = xx + k;
                if (xxx < 0 || xxx >= w2) continue;
                const a = dd[(y * w2 + xxx) * 4 + 3];
                if (a > m) m = a;
              }
              const o = (y * w2 + xx) * 4;
              tmp[o] = dd[o]; tmp[o + 1] = dd[o + 1]; tmp[o + 2] = dd[o + 2]; tmp[o + 3] = m;
            }
          }
          for (let y = 0; y < h2; y++) {
            for (let xx = 0; xx < w2; xx++) {
              let m = 0;
              for (let k = -dilateR; k <= dilateR; k++) {
                const yy = y + k;
                if (yy < 0 || yy >= h2) continue;
                const a = tmp[(yy * w2 + xx) * 4 + 3];
                if (a > m) m = a;
              }
              dd[(y * w2 + xx) * 4 + 3] = m;
            }
          }
        }
        x.putImageData(id, 0, 0);
        return c;
      }

      // 几何 / 粗笔画源图：轻增强即可，别过度加粗
      const maskThin  = makeMask(1024, 1.1, 0);
      const maskBold  = makeMask(512, 1.25, 2);
      const maskSmall = makeMask(256, 1.2, 1);

      /* ---- 4. squircle 应用图标（白底 + 圆角）---- */
      function squircleIcon(size, mask, ratio, binarize) {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const x = c.getContext('2d');
        x.fillStyle = '#FFFFFF';
        x.beginPath();
        x.roundRect(0, 0, size, size, size * 0.2237);
        x.fill();
        x.save();
        x.beginPath();
        x.roundRect(0, 0, size, size, size * 0.2237);
        x.clip();
        const box = size * ratio;
        const k = Math.min(box / cw, box / ch);
        const dw = cw * k, dh = ch * k;
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = 'high';
        x.drawImage(mask, (size - dw) / 2, (size - dh) / 2, dw, dh);
        x.restore();
        if (binarize) {
          // 16/24px：降采样后笔画发灰，硬阈值切黑白保字形可辨
          const id = x.getImageData(0, 0, size, size);
          const dd = id.data;
          for (let i = 0; i < dd.length; i += 4) {
            if (dd[i + 3] === 0) continue;
            const m = Math.min(dd[i], dd[i + 1], dd[i + 2]);
            const v = m < 150 ? 0 : 255;
            dd[i] = dd[i + 1] = dd[i + 2] = v;
          }
          x.putImageData(id, 0, 0);
        }
        return c;
      }

      const RATIO = ${RATIO};
      const result = { crop: cw + 'x' + ch, sizes: {} };
      result.sizes[16] = squircleIcon(16, maskBold, RATIO, true).toDataURL('image/png');
      result.sizes[24] = squircleIcon(24, maskBold, RATIO, true).toDataURL('image/png');
      result.sizes[32] = squircleIcon(32, maskBold, RATIO).toDataURL('image/png');
      result.sizes[48] = squircleIcon(48, maskBold, RATIO).toDataURL('image/png');
      result.sizes[64] = squircleIcon(64, maskBold, RATIO).toDataURL('image/png');
      result.sizes[128] = squircleIcon(128, maskBold, RATIO).toDataURL('image/png');
      for (const s of [256, 512, 1024]) result.sizes[s] = squircleIcon(s, maskThin, RATIO).toDataURL('image/png');
      // 标题栏：按显示尺寸 2x 出图，retina 下不糊
      result.titlebar = squircleIcon(${TITLEBAR} * 2, maskSmall, RATIO).toDataURL('image/png');
      result.about = result.sizes[128];
      return result;
    })()
  `);

  /* ---- 5. 落盘 ---- */
  for (const s of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
    const b64 = out.sizes[s].replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(FINAL, `icon-${s}.png`), Buffer.from(b64, 'base64'));
  }
  log('图标 PNG →%s（裁剪 %s，ratio %s）', FINAL, out.crop, RATIO);

  /* ---- 6. 注入界面（幂等：重复跑会替换上一次注入的 data URI）---- */
  const R = path.join(DEV, 'src', 'renderer');

  const htmlPath = path.join(R, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');
  const imgRe = /<img src="data:image\/png;base64,[^"]*" alt="轻墨" width="\d+" height="\d+" \/>/;
  if (imgRe.test(html)) {
    html = html.replace(imgRe,
      `<img src="${out.titlebar}" alt="轻墨" width="${TITLEBAR}" height="${TITLEBAR}" />`);
    fs.writeFileSync(htmlPath, html);
    log('index.html：标题栏 LOGO 已更新（%dpx 显示）', TITLEBAR);
  } else {
    log('! index.html 没匹配到 LOGO img，需手工检查');
  }

  const updPath = path.join(R, 'update.js');
  let upd = fs.readFileSync(updPath, 'utf-8');
  const aboutRe = /<img src="data:image\/png;base64,[^"]*" alt="轻墨" width="\d+" height="\d+" \/>/;
  const aboutSvg = '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
  if (aboutRe.test(upd)) {
    upd = upd.replace(aboutRe, `<img src="${out.about}" alt="轻墨" width="${ABOUT}" height="${ABOUT}" />`);
    fs.writeFileSync(updPath, upd);
    log('update.js：关于弹窗 LOGO 已更新（%dpx 显示）', ABOUT);
  } else if (upd.includes(aboutSvg)) {
    upd = upd.replace(aboutSvg, `<img src="${out.about}" alt="轻墨" width="${ABOUT}" height="${ABOUT}" />`);
    fs.writeFileSync(updPath, upd);
    log('update.js：关于弹窗 LOGO 已写入（%dpx 显示）', ABOUT);
  } else {
    log('! update.js 没匹配到 about LOGO，需手工检查');
  }

  app.exit(0);
}).catch(e => { log('X %s', e.stack || e.message); app.exit(1); });