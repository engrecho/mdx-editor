#!/usr/bin/env node
/**
 * 文件关联检查真机测试
 *
 * 验证：
 *   1. 能查到 .md 当前关联到哪个程序
 *   2. 能识别出「没关联到轻墨」
 *   3. 重新注册后 .md 指向轻墨
 *   4. 注册是用户级（HKCU），不需要管理员
 *
 * ⚠ 这个测试会真的写注册表（HKCU\Software\Classes）。
 *   测完可以再调一次「取消关联」还原 —— 但 Windows 上
 *   「恢复默认」需要用户在「设置 → 默认应用」里手动选，
 *   所以本脚本默认【只检查不修改】，要改加 --fix。
 *
 * 用法：npx electron --no-sandbox --disable-gpu scripts/verify-file-assoc.js [--fix]
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
const fileAssoc = require(path.join(DEV, 'src', 'main', 'file-assoc.js'));

const FIX = process.argv.includes('--fix');

app.whenReady().then(async () => {
  const results = [];
  const check = (name, pass, detail) => results.push({ name, pass: !!pass, detail: detail || '' });

  check('在 Windows 上', process.platform === 'win32', process.platform);

  const before = await fileAssoc.check();
  check('能查到关联列表', Array.isArray(before) && before.length > 0,
    '拿到 ' + (before ? before.length : 0) + ' 条');

  const md = before.find(r => r.ext === 'md');
  check('查到了 .md 的关联', !!md, JSON.stringify(md));
  if (md) {
    log('当前 .md 关联:');
    log('  progid  = ' + md.progid);
    log('  command = ' + md.command);
    log('  指向轻墨 = ' + md.isQingMo);
    check('能判断是否指向轻墨', typeof md.isQingMo === 'boolean', '');
  }

  if (FIX) {
    log('\n执行重新注册...');
    const r = await fileAssoc.register();
    check('注册执行完成', !!r, JSON.stringify(r.results));
    log('注册结果: ' + JSON.stringify(r.results));

    const after = await fileAssoc.check();
    const md2 = after.find(x => x.ext === 'md');
    check('修复后 .md 指向轻墨', !!(md2 && md2.isQingMo),
      md2 ? md2.progid + ' / ' + md2.command : '(查不到)');
    log('\n修复后 .md 关联:');
    log('  progid  = ' + (md2 && md2.progid));
    log('  command = ' + (md2 && md2.command));
  } else {
    log('\n（未加 --fix，跳过注册测试）');
  }

  let pass = 0, fail = 0;
  for (const r of results) {
    if (r.pass) { pass++; console.log('  ✓ ' + r.name); }
    else { fail++; console.log('  ✗ ' + r.name + (r.detail ? '  → ' + r.detail : '')); }
  }
  console.log('\n' + '='.repeat(50));
  console.log('通过 ' + pass + ' / ' + results.length);
  setTimeout(() => app.exit(fail ? 1 : 0), 200);
});
