/**
 * 渲染进程日志 —— 把异常送回主进程写进日志文件
 *
 * 覆盖三类：
 *   1. 未捕获异常（window.onerror）
 *   2. 未处理的 Promise 拒绝（unhandledrejection）
 *   3. 显式上报（logError('xxx', msg)）—— 编辑/渲染失败时用
 *
 * 另外在本地留一份最近的记录，即使 IPC 不通也能在界面上看到。
 */
const RING_MAX = 50;
const ring = [];

function localRecord(kind, message, extra) {
  const item = {
    time: localStamp(),
    kind, message,
    extra: extra === undefined ? '' : (typeof extra === 'string' ? extra : safeJson(extra))
  };
  ring.push(item);
  while (ring.length > RING_MAX) ring.shift();
  return item;
}

/** 本地时间戳 —— 用户看日志要跟自己的钟对得上 */
function localStamp(d) {
  const t = d || new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ` +
    `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${p(t.getMilliseconds(), 3)}`;
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch (e) { return '(无法序列化)'; }
}

/** 通过 IPC 送到主进程 */
function report(kind, message, extra) {
  const item = localRecord(kind, message, extra);
  try {
    const api = window.api;
    if (api && typeof api.reportLog === 'function') {
      api.reportLog({ kind, message, stack: item.extra, extra: '' });
    }
  } catch (e) { /* IPC 不通就算了，本地还有记录 */ }
  return item;
}

/** 挂上全局错误捕获（在应用启动早期调用） */
function install() {
  window.addEventListener('error', (ev) => {
    report('error', ev.message || '未捕获异常', {
      stack: ev.error && ev.error.stack,
      file: ev.filename,
      line: ev.lineno,
      column: ev.colno
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    report('unhandledrejection',
      (r && (r.message || r.toString())) || '未处理的 Promise 拒绝',
      { stack: r && r.stack });
  });
}

const logError = (kind, message, extra) => report(kind || 'error', message, extra);
const logInfo = (message, extra) => report('info', message, extra);

/** 最近的本地记录（界面上可以显示） */
const recent = () => ring.slice();

export { install, report, logError, logInfo, recent };
