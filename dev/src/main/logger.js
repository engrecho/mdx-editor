/**
 * 主进程日志
 *
 * 为什么需要：
 *   用户反馈「有时候双击 md 打不开文件」——而原来的代码里
 *   所有失败路径都是 `return false`，一个字都不留，
 *   用户和开发者都无从判断到底是哪一步挂了。
 *
 * 设计：
 *   · 落在 userData/logs/ 下，一天一个文件
 *   · 每次启动写一段 header（版本 / 平台 / 启动参数 / 可执行文件路径）
 *   · 文件打开、窗口创建、更新检查等关键节点都记
 *   · 渲染进程通过 IPC 把异常送上来
 *   · 提供「导出诊断日志」：把最近日志复制到剪贴板并打开日志目录
 */
const fs = require('fs');
const path = require('path');
const util = require('util');

let logDir = null;
let logFile = null;
let fsyncTimer = null;
let pending = [];

/**
 * 本地时间戳（YYYY-MM-DD HH:mm:ss.SSS）
 *
 * 用本地时间而不是 UTC —— 用户看日志时对得上自己的钟。
 */
function localStamp(d) {
  const t = d || new Date();
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return `${localDay(t)} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.` +
    p(t.getMilliseconds(), 3);
}

/**
 * 本地日期（YYYY-MM-DD）。
 *
 * 不能用 toISOString() —— 那是 UTC 日期。
 * 在东八区，本地 10-24 凌晨 0 点时 UTC 还是 10-23，
 * 日志文件名会写成前一天，用户找「今天的日志」就找不到。
 */
function localDay(d) {
  const t = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

/** 初始化（在 app ready 之后调用） */
function init(app) {
  try {
    logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const day = localDay();
    logFile = path.join(logDir, `qingmo-${day}.log`);
    // 启动 header —— 排查问题第一步要看的就是这段
    write('INFO', '=== 轻墨 QingMo 启动 ===', {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      execPath: process.execPath,
      cwd: process.cwd(),
      userData: app.getPath('userData'),
      logFile
    });
    write('INFO', '启动参数 argv', { argv: process.argv });
    return true;
  } catch (e) {
    // 日志系统本身不能把应用搞挂
    console.error('日志初始化失败:', e && e.message);
    return false;
  }
}

/** 写一条日志 */
function write(level, msg, data) {
  const ts = localStamp();
  let line = `[${ts}] [${level}] ${msg}`;
  if (data !== undefined) {
    let extra;
    try {
      extra = typeof data === 'string' ? data : JSON.stringify(data);
    } catch (e) {
      extra = '(无法序列化: ' + e.message + ')';
    }
    line += ' ' + extra;
  }
  pending.push(line);
  console.error(line);

  // 合并写盘 —— 高频日志时不至于每个都 fsync
  if (fsyncTimer) return;
  fsyncTimer = setTimeout(flush, 300);
  if (fsyncTimer.unref) fsyncTimer.unref();
}

/** 把缓冲刷到文件 */
function flush() {
  if (fsyncTimer) { clearTimeout(fsyncTimer); fsyncTimer = null; }
  if (!pending.length) return;
  const batch = pending.join('\n') + '\n';
  pending = [];
  try {
    if (!logFile) return;
    fs.appendFileSync(logFile, batch, 'utf8');
  } catch (e) {
    console.error('日志写盘失败:', e && e.message);
  }
}

const info = (msg, data) => write('INFO', msg, data);
const warn = (msg, data) => write('WARN', msg, data);
const error = (msg, data) => write('ERROR', msg, data);

/**
 * 记录一次「打开文件」的尝试 —— 含失败原因。
 *
 * 原来这里是裸的 return false，用户完全看不到失败原因。
 * 现在每种失败都带上具体的判定依据。
 */
function fileOpenAttempt(p, ok, reason) {
  if (ok) {
    info('打开文件成功', { path: p, reason: reason || '' });
  } else {
    warn('打开文件失败', { path: p, reason: reason || '(未说明原因)' });
  }
}

/** 渲染进程上报的错误 —— 按 kind 分级，不要一律当 ERROR */
function fromRenderer(payload) {
  const { kind, message, stack, extra } = payload || {};
  const tag = '渲染进程[' + (kind || 'unknown') + ']';
  const data = { stack, extra };
  switch (kind) {
    case 'info':
      info(tag + ' ' + (message || ''), data);
      break;
    case 'warn':
      warn(tag + ' ' + (message || ''), data);
      break;
    default:
      error(tag + ' ' + (message || ''), data);
  }
}

/** 读取最近 N 行日志（用于导出） */
function tail(lines) {
  flush();
  if (!logFile || !fs.existsSync(logFile)) return '';
  try {
    const all = fs.readFileSync(logFile, 'utf8').split('\n');
    const n = lines || 500;
    return all.slice(-n).join('\n');
  } catch (e) {
    return '(读取日志失败: ' + e.message + ')';
  }
}

/** 日志目录（给「打开日志文件夹」用） */
function dir() { return logDir; }
function file() { return logFile; }

/** 清理超过 N 天的旧日志 */
function cleanup(days) {
  if (!logDir) return 0;
  const keep = days || 14;
  let removed = 0;
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(logDir)) {
      if (!/^qingmo-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const p = path.join(logDir, f);
      const age = (now - fs.statSync(p).mtimeMs) / 86400000;
      if (age > keep) { fs.unlinkSync(p); removed++; }
    }
  } catch (e) { /* 忽略 */ }
  return removed;
}

module.exports = {
  init, info, warn, error, write, flush,
  fileOpenAttempt, fromRenderer, tail, dir, file, cleanup
};
