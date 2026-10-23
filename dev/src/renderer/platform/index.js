/**
 * 渲染层平台标识
 *
 * 主进程通过 preload 把 process.platform 暴露成 window.api.platform，
 * 这里把它写到 <html data-platform="..."> 上，供样式做平台专属处理：
 *   styles/mac.css —— macOS 标题栏左侧避让系统红绿灯
 *   styles/win.css —— Windows 标题栏右侧避让原生窗口按钮
 *
 * 以副作用模块的方式引入（import './platform/index.js'），
 * 保证在首帧绘制前就写好标记，避免闪一下默认布局。
 */
export const platformId = (window.api && window.api.platform) || 'unknown';

if (window.api && window.api.platform) {
  document.documentElement.dataset.platform = window.api.platform;
}
