/**
 * Windows 专属实现
 *
 * 与 macOS 的主要差异：
 *   1. 标题栏用系统默认样式
 *   2. 没有应用级菜单，「文件」菜单末尾是 quit
 *   3. 任务栏图标用 app.setIcon
 *   4. 双击 / 命令行传文件时路径在 argv 里，没有 open-file 事件
 *   5. 窗口全关即退出
 *   6. 更新资产是 win-setup.exe / win-portable.exe
 *
 * 说明：linux 等未单独适配的平台暂时复用本实现（属于「非 macOS」：
 * 走 argv 传参、窗口全关即退出）。
 */
const base = require('./base');

module.exports = {
  ...base,
  id: 'win',

  titleBarStyle: 'default',
  appMenuItem: null,
  quitMenuItem: { role: 'quit' },

  setAppIcon(app, nativeImage, icon) {
    try { app.setIcon(nativeImage.createFromPath(icon)); } catch (e) {}
  },

  /** Windows / Linux：只有命令行传参这一条路径（没有 open-file 事件） */
  registerFileOpen(app, isDocPath, openPathInApp) {
    base.registerFileOpen(app, isDocPath, openPathInApp);
  },

  quitOnAllWindowsClosed: true,

  matchUpdateAsset(assets) {
    return assets.find(a => /\.exe$/i.test(a.name) && /setup/i.test(a.name))
        || assets.find(a => /\.exe$/i.test(a.name));
  }
};
