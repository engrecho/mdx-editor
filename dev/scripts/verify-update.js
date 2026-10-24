#!/usr/bin/env node
/**
 * 版本更新检查测试
 *
 * 覆盖三个真实踩过的坑：
 *   1. 当前平台没有对应资源时，不能说「有更新可下载」
 *      （v1.5.0 / v1.5.1 的 Release 只发了 mac，Windows 用户点下载拿不到 .exe）
 *   2. 版本比较要正确处理 1.10.0 > 1.9.0（不能按字符串比）
 *   3. 平台资源匹配：Windows 要 setup.exe，mac 要对应架构
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/verify-update.js
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
const skip = (name, why) => results.push({ name, pass: true, detail: 'SKIP: ' + why, skipped: true });

// ⚠ 用【main.js 用的同一份实现】，不要在这里复制一份 ——
//   之前复制过，结果 main.js 修了 v 前缀处理、这份没修，测试就挂了。
const { compareVersion } = require(path.join(DEV, 'src', 'main', 'version.js'));

app.whenReady().then(async () => {
  const platform = require(path.join(DEV, 'src', 'main', 'platform'));
  const win = platform.id === 'win' ? require(path.join(DEV, 'src', 'main', 'platform', 'win.js')) : null;
  const mac = platform.id === 'mac' ? require(path.join(DEV, 'src', 'main', 'platform', 'mac.js')) : null;

  /* ============ A. 版本比较 ============ */
  check('A/相同版本', compareVersion('1.5.1', '1.5.1') === 0);
  check('A/小版本更新', compareVersion('1.5.2', '1.5.1') === 1);
  check('A/大版本更新', compareVersion('2.0.0', '1.9.9') === 1);
  check('A/十位数大于九位数', compareVersion('1.10.0', '1.9.0') === 1,
    '字符串比较会得出错误结果');
  check('A/补丁号比较', compareVersion('1.5.10', '1.5.9') === 1);
  check('A/旧版本', compareVersion('1.5.0', '1.5.1') === -1);
  check('A/带 v 前缀', compareVersion('v1.6.0', '1.5.1') === 1);

  /* ============ B. Windows 资源匹配 ============ */
  if (win) {
    const winAssets = [
      { name: 'QingMo-1.5.1-mac-arm64.zip', size: 1, url: 'u1' },
      { name: 'QingMo-1.5.1-mac-x64.zip', size: 1, url: 'u2' }
    ];
    check('B/只有 mac 资源时匹配不到', !win.matchUpdateAsset(winAssets, 'x64'));

    const withExe = winAssets.concat([
      { name: 'QingMo-1.5.1-win-setup.exe', size: 1, url: 'u3' },
      { name: 'QingMo-1.5.1-win-portable.exe', size: 1, url: 'u4' }
    ]);
    const m = win.matchUpdateAsset(withExe, 'x64');
    check('B/优先选 setup.exe', m && m.name === 'QingMo-1.5.1-win-setup.exe', m && m.name);

    const onlyPortable = [{ name: 'QingMo-1.5.1-win-portable.exe', size: 1, url: 'u4' }];
    const m2 = win.matchUpdateAsset(onlyPortable, 'x64');
    check('B/只有 portable 也算能下载', !!m2, m2 && m2.name);
  }

  /* ============ C. mac 资源匹配（按架构）=========== */
  if (mac) {
    const macAssets = [
      { name: 'QingMo-1.5.1-mac-arm64.zip', size: 1, url: 'a' },
      { name: 'QingMo-1.5.1-mac-x64.zip', size: 1, url: 'x' }
    ];
    const ma = mac.matchUpdateAsset(macAssets, 'arm64');
    const mx = mac.matchUpdateAsset(macAssets, 'x64');
    check('C/arm64 匹配到 arm64 包', ma && /arm64/.test(ma.name), ma && ma.name);
    check('C/x64 匹配到 x64 包', mx && /x64/.test(mx.name) && !/arm64/.test(mx.name), mx && mx.name);
  }

  /* ============ D. 平台未就绪的判定 ============ */
  // 模拟 main.js 的判定逻辑
  function decide(current, latest, match) {
    const newer = compareVersion(latest, current) > 0;
    const platformReady = !!match;
    return { hasUpdate: newer && platformReady, newerExists: newer, platformReady };
  }
  {
    const d = decide('1.3.0', '1.5.1', null);
    check('D/有新版但没资源 → hasUpdate 为假', d.hasUpdate === false);
    check('D/有新版但没资源 → newerExists 为真', d.newerExists === true);
    check('D/有新版但没资源 → platformReady 为假', d.platformReady === false);
  }
  {
    const d = decide('1.3.0', '1.5.1', { name: 'x.exe' });
    check('D/有新版且有资源 → canUpdate', d.hasUpdate === true);
  }
  {
    const d = decide('1.5.1', '1.5.1', null);
    check('D/已是最新 → 没有新版', d.newerExists === false);
    check('D/已是最新 → 不提示', d.hasUpdate === false);
  }

  /* ============ E. 真实 GitHub Release ============ */
  try {
    const res = await fetch('https://api.github.com/repos/engrecho/qingmo/releases/latest', {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'QingMo-Update-Check' }
    });
    if (res.status === 403 || res.status === 429) {
      // 匿名 API 60 次/小时 —— 限流不是代码问题，网络断言跳过
      // （降级路径由 verify-update-fallback.js 单独验证）
      skip('E/GitHub API 可达', '匿名限流（HTTP ' + res.status + '）');
      skip('E/能解析版本号', '匿名限流');
      skip('E/latest.yml 已上传（自动更新前提）', '匿名限流');
      skip('E/当前平台有对应资源', '匿名限流');
    } else {
      check('E/GitHub API 可达', res.ok, 'HTTP ' + res.status);
      const data = await res.json();
      const latest = String(data.tag_name || '').replace(/^v/i, '');
      check('E/能解析版本号', !!latest, latest);

      const assets = (data.assets || []).map(a => ({ name: a.name, size: a.size, url: a.browser_download_url }));
      check('E/latest.yml 已上传（自动更新前提）',
        assets.some(a => a.name === 'latest.yml'),
        '当前资源: ' + assets.map(a => a.name).join(', '));

      const match = platform.matchUpdateAsset(assets, process.arch);
      check('E/当前平台有对应资源', !!match,
        '匹配到: ' + (match ? match.name : '(无) —— 该平台暂不可自动更新)'));
    }
  } catch (e) {
    skip('E/GitHub API 可达', e.message);
  }

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('  ✓ ' + r.name + (r.skipped ? '  (' + r.detail + ')' : '')); }
    else { fail++; console.log('  ✗ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + results.length);
  setTimeout(() => app.exit(fail ? 1 : 0), 200);
});
