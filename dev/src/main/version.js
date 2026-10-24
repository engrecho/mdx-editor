/**
 * 版本号比较
 *
 * 抽成独立模块是为了让 main.js 和测试用【同一份实现】——
 * 之前测试里自己复制了一份，结果 main.js 修了 v 前缀处理、
 * 测试那份没修，测试就挂了（而且是「测试错了」不是「代码错了」）。
 */

/**
 * 比较两个版本号。
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} a>b 返回正数，a<b 返回负数，相等返回 0
 */
function compareVersion(a, b) {
  // 要去掉 v 前缀 —— tag 可能是 'v1.5.1'，
  // 而 parseInt('v1') 是 NaN，会被 || 0 兜成 0，
  // 于是 'v1.6.0' 被当成 '0.0.0'，比任何版本都小。
  const norm = (s) => String(s).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

module.exports = { compareVersion };
