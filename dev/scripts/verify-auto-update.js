/**
 * 校验自动更新的前提条件：
 *   1. latest.yml 存在
 *   2. yml 里的 path 与实际产物文件名一致（不一致 → 下载 404）
 *   3. .blockmap 存在（差量更新）
 *   4. sha512 与实际文件一致（校验用）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIST = process.argv[2] || path.join(__dirname, '..', '..', 'dist');
const ymlPath = path.join(DIST, 'latest.yml');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
};

if (!fs.existsSync(ymlPath)) {
  console.log('  ✗ latest.yml 不存在：' + ymlPath);
  console.log('\n  提示：package.json 的 build.publish 必须配了 GitHub provider，');
  console.log('        electron-builder 才会生成 latest.yml。');
  process.exit(1);
}

const yml = fs.readFileSync(ymlPath, 'utf8');
console.log('latest.yml:\n' + yml.split('\n').map(l => '  ' + l).join('\n') + '\n');

const get = (key) => {
  const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(yml);
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
};

// size 在 yml 里是嵌套的（files: 下面那一项），顶层没有
const getNestedSize = () => {
  const m = /^\s+-\s+url:\s*(.+)\n\s+sha512:\s*(.+)\n\s+size:\s*(\d+)/m.exec(yml);
  return m ? { url: m[1].trim(), size: parseInt(m[3], 10) } : null;
};

const filePath = get('path');
const sha512 = get('sha512');
const nested = getNestedSize();
const size = nested ? nested.size : 0;

check('latest.yml 存在', true);
check('含 version', !!get('version'), get('version'));
check('含 path', !!filePath, filePath);
check('含 sha512', !!sha512, '');
check('files 块含 url', !!(nested && nested.url), nested && nested.url);
check('files 块含 size', size > 0, String(size));
check('files.url 与 path 一致', nested && nested.url === filePath,
  (nested && nested.url) + ' vs ' + filePath);

// ① 文件名一致
const target = path.join(DIST, filePath || '');
check('path 指向的文件真实存在', fs.existsSync(target), target);

// ② 体积一致
if (fs.existsSync(target)) {
  const real = fs.statSync(target).size;
  check('size 与实际一致', real === size, `yml=${size} 实际=${real}`);
}

// ③ sha512 一致
if (fs.existsSync(target) && sha512) {
  const real = crypto.createHash('sha512')
    .update(fs.readFileSync(target)).digest('base64');
  check('sha512 与实际一致', real === sha512, '校验失败 —— 会被 electron-updater 拒绝');
}

// ④ blockmap 存在
const bm = target + '.blockmap';
check('.blockmap 存在（差量更新）', fs.existsSync(bm), path.basename(bm));

// ⑤ 所有 exe 是否都有对应的 yml 引用
const exes = fs.readdirSync(DIST).filter(f => /\.exe$/.test(f) && !/blockmap/.test(f));
check('yml 只指向 setup 版（便携版不参与自动更新）',
  /setup/i.test(filePath || ''), filePath);

console.log('\n' + '='.repeat(50));
console.log('通过 ' + pass + ' / ' + (pass + fail));
console.log('产物目录: ' + DIST);
console.log('exe 文件: ' + exes.join(', '));
if (fail) process.exit(1);
console.log('\n✅ 自动更新前提齐备');
console.log('   发布时记得把 latest.yml 一起传到 Release（release.js 已支持）');
