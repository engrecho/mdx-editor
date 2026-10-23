/**
 * 平台实现统一出口
 *
 * 按当前运行平台装载对应实现，main.js 只跟这里打交道，
 * 不出现任何 process.platform 分支。
 *
 * 新增平台：在 IMPLS 里加一条，再写一个 <平台>.js 即可。
 */
const IMPLS = {
  darwin: './mac',
  win32: './win'
};

// 未单独适配的平台（linux 等）复用 win 实现
const chosen = IMPLS[process.platform] || IMPLS.win32;

module.exports = require(chosen);
