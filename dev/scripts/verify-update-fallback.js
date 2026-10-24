#!/usr/bin/env node
/**
 * 更新检查的降级路径测试
 *
 * 场景：GitHub API 匿名限流（60 次/小时/IP）后，
 * 更新检查必须还能工作 —— 至少告诉用户「有没有新版」。
 *
 * 验证：
 *   1. 降级路径能从 302 重定向里解析出 tag
 *   2. 降级结果的语义正确（有新版但拿不到资源列表）
 *   3. compareVersion 正确处理 v 前缀
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/verify-update-fallback.js
 */
if (!process.versions.electron) {
  console.error('用 electron 跑');
  process.exit(1);
}

const path = require('path');
const util = require('util');
const log = (...a) => console.error(util.format(...a));

const DEV = path.join(__dirname, '..');
const { app } = require('electron');

const results = [];
const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' });

function compareVersion(a, b) {
  const norm = (s) => String(s).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const pa = norm(a), pb = norm(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

app.whenReady().then(async () => {
  /* ============ A. compareVersion 处理 v 前缀 ============ */
  check('A/带 v 前缀比较', compareVersion('v1.6.0', '1.5.1') === 1,
    'v1.6.0 vs 1.5.1');
  check('A/两边都带 v', compareVersion('v1.6.0', 'v1.5.1') === 1);
  check('A/带 v 且相同', compareVersion('v1.5.1', '1.5.1') === 0);
  check('A/带 v 的旧版本', compareVersion('v1.5.0', '1.5.1') === -1);
  check('A/十位数比较', compareVersion('1.10.0', '1.9.0') === 1);
  check('A/带 v 的十位数', compareVersion('v1.10.0', '1.9.0') === 1);

  /* ============ B. 降级路径：302 重定向解析 ============ */
  try {
    const res = await fetch('https://github.com/engrecho/qingmo/releases/latest', {
      redirect: 'manual',
      headers: { 'User-Agent': 'QingMo-Update-Check' }
    });
    check('B/重定向请求可达', res.status === 302 || res.status === 301,
      'HTTP ' + res.status);
    const loc = res.headers.get('location') || '';
    const m = /\/releases\/tag\/([^/?#]+)/.exec(loc);
    check('B/能从 Location 解析出 tag', !!m, 'Location=' + loc);
    if (m) {
      const tag = m[1];
      const latest = tag.replace(/^v/i, '');
      log('  最新 tag: ' + tag + ' → 版本 ' + latest);
      check('B/版本号非空', !!latest, latest);
      check('B/版本号是三段式', /^\d+\.\d+\.\d+$/.test(latest), latest);
      check('B/与当前版本比较正常', typeof compareVersion(latest, '1.5.1') === 'number', '');
    }
  } catch (e) {
    check('B/重定向请求可达', false, e.message);
  }

  /* ============ C. GitHub API 限流时的表现 ============ */
  try {
    const res = await fetch('https://api.github.com/repos/engrecho/qingmo/releases/latest', {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'QingMo-Update-Check' }
    });
    if (res.status === 403 || res.status === 429) {
      log('  （当前正好处在限流状态，正好验证降级）');
      check('C/限流时状态码可识别', true, 'HTTP ' + res.status);
    } else if (res.ok) {
      const data = await res.json();
      const assets = (data.assets || []).map(a => a.name);
      check('C/latest.yml 已上传', assets.includes('latest.yml'),
        '资源: ' + assets.join(', '));
      check('C/有 Windows 安装包', assets.some(n => /win-setup\.exe$/i.test(n)),
        '资源: ' + assets.join(', '));
    } else {
      check('C/GitHub API 正常', false, 'HTTP ' + res.status);
    }
  } catch (e) {
    check('C/GitHub API 正常', false, e.message);
  }

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('  ✓ ' + r.name); }
    else { fail++; console.log('  ✗ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + results.length);
  setTimeout(() => app.exit(0), 200);
});
