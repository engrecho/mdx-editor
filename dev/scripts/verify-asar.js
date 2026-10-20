// 校验打包产物里的 main.js 正则是否已修复
// 用法: node scripts/verify-asar.js <asar路径>
const fs = require('fs');
const path = require('path');

const asarPath = process.argv[2];
if (!asarPath) {
  console.error('用法: node scripts/verify-asar.js <asar路径>');
  process.exit(1);
}

const b = fs.readFileSync(asarPath);

// asar 头部是 Chromium Pickle 格式：
//   u32@0  = 4                （pickle payload 长度）
//   u32@4  = headerPickleSize （整个 header 区大小，含嵌套 pickle 头）
//   u32@8  = headerPickleSize - 4
//   u32@12 = jsonLength       （JSON 字符串实际长度）
//   JSON 从偏移 16 开始
//   文件数据区起点 = 8 + u32@4
const headerPickleSize = b.readUInt32LE(4);
const jsonLength = b.readUInt32LE(12);
const header = JSON.parse(b.toString('utf8', 16, 16 + jsonLength));
const root = header.files;
const dataStart = 8 + headerPickleSize;

/** 按路径读取 asar 内文件内容 */
function readEntry(p) {
  const parts = p.split('/');
  // root 本身即 children 表；每个目录节点的形态是 { files: { name: child } }
  let node = { files: root };
  for (const seg of parts) {
    if (!node || !node.files) return null;
    node = node.files[seg];
  }
  if (!node || node.files) return null;   // 目标是文件而非目录
  const start = dataStart + parseInt(node.offset, 10);
  return b.toString('utf8', start, start + parseInt(node.size, 10));
}

const code = readEntry('src/main/main.js');
if (!code) {
  console.error('✗ asar 内找不到 src/main/main.js');
  process.exit(1);
}

const lines = code.split('\n');

// 1. 定位 openExternal 的 IPC 处理
const idx = lines.findIndex(l => l.includes("app:openExternal"));
console.log('=== app:openExternal 段 ===');
if (idx >= 0) {
  for (let i = idx; i < Math.min(idx + 7, lines.length); i++) {
    console.log((i + 1) + ': ' + lines[i]);
  }
}

// 2. 抽出正则字面量实际执行一次
// 不用正则去匹配正则（转义地狱），改为定位 .test(url) 前面的字面量。
// 注意：文件里有多处 .test(url)，必须从 app:openExternal 之后开始找。
// 2. 抽出正则字面量实际执行一次
// 直接用 vm 求值那一行表达式，避免手工处理转义斜杠
let regexOk = false;
const anchor = code.indexOf("app:openExternal");
const searchFrom = anchor > 0 ? anchor : 0;
const testIdx = code.indexOf('.test(url)', searchFrom);
if (testIdx > 0) {
  // 找包含 .test(url) 的那一整行的正则部分：从最近的 "/xxx/" 到 .test(
  const lineStart = code.lastIndexOf('\n', testIdx) + 1;
  const line = code.slice(lineStart, testIdx);
  // 该行形如:  if (typeof url === 'string' && /^https?:\/\//i) {
  // 取出最后一个 "/.../" 字面量（按 JS 词法：/ 后跟非 / 字符到下一个未被转义的 /）
  const m = line.match(/(\/(?:\\.|\[(?:\\.|[^\]])*\]|[^\\/])+)\/([a-z]*)/);
  if (m) {
    const lit = m[1].slice(1);   // 去掉开头 /
    const flags = m[2];
    console.log('\n=== 正则字面量 ===');
    console.log('  内容: /' + lit + '/' + flags);
    try {
      const re = new RegExp(lit, flags);
      regexOk = re.test('https://github.com/engrecho/qingmo/releases/latest');
      console.log('  匹配 https://    :', re.test('https://github.com'));
      console.log('  拒绝 file://     :', !re.test('file:///etc/passwd'));
      console.log('  拒绝 javascript: :', !re.test('javascript:alert(1)'));
    } catch (e) {
      console.log('  解析失败: ' + e.message);
    }
  } else {
    console.log('\n未能从该行提取正则字面量: ' + line.trim());
  }
} else {
  console.log('\n未找到 .test(url) 调用');
}

// 3. 语法自检：写到临时文件后用 node --check（纯解析，不执行）
let syntaxOk = true;
let syntaxErr = '';
const tmp = path.join(require('os').tmpdir(), 'asar-verify-' + Date.now() + '.js');
try {
  fs.writeFileSync(tmp, code);
  const { execFileSync } = require('child_process');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    syntaxOk = false;
    syntaxErr = (e.stderr ? e.stderr.toString() : e.message).split('\n')
      .filter(l => l.includes('Error') || l.includes('^')).slice(0, 2).join(' | ');
  }
} finally {
  try { fs.unlinkSync(tmp); } catch (e) {}
}
console.log('\n=== 语法自检 ===');
console.log('  main.js 解析:', syntaxOk ? '✅ 通过' : '❌ ' + syntaxErr);

const pass = regexOk && syntaxOk;
console.log('\n' + (pass ? '✅ 校验通过' : '❌ 校验未通过'));
process.exit(pass ? 0 : 1);
