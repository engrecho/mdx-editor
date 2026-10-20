/* ============================================
   版本更新检测
   ============================================ */

const UPDATE_KEY = 'qingmo.update.lastCheck';
const UPDATE_DAY = 24 * 60 * 60 * 1000;   // 24 小时检查一次

let updateInfo = null;      // 最近一次检查结果
let updateBanner = null;    // 顶部提示条元素

/** 判断是否该检查（距上次检查超过 24 小时） */
function shouldCheckUpdate() {
  try {
    const last = parseInt(localStorage.getItem(UPDATE_KEY) || '0', 10);
    return Date.now() - last > UPDATE_DAY;
  } catch (e) { return true; }
}

function markChecked() {
  try { localStorage.setItem(UPDATE_KEY, String(Date.now())); } catch (e) {}
}

/** 检查更新 */
async function checkUpdate(force = false) {
  if (!window.api || !window.api.checkUpdate) return null;
  if (!force && !shouldCheckUpdate()) return updateInfo;

  try {
    const r = await window.api.checkUpdate();
    markChecked();
    updateInfo = r;
    if (r && r.ok) {
      if (r.hasUpdate) showUpdateBanner(r);
      else hideUpdateBanner();
    }
    return r;
  } catch (e) {
    updateInfo = { ok: false, error: e.message };
    return updateInfo;
  }
}

/* ---------- 顶部提示条 ---------- */
function showUpdateBanner(info) {
  hideUpdateBanner();

  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.innerHTML = `
    <span class="ub-icon"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 20h16"/></svg></span>
    <span class="ub-text">发现新版本 <b>${info.latest}</b>（当前 ${info.current}）</span>
    <button class="ub-btn primary" data-act="download">前往下载</button>
    <button class="ub-btn" data-act="details">查看详情</button>
    <button class="ub-btn icon" data-act="dismiss" title="忽略此版本">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
  `;

  bar.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'download') {
      // 优先直接下载匹配当前平台的资源
      const url = (info.match && info.match.url) || info.releaseUrl;
      window.api.openExternal(url);
    } else if (act === 'details') {
      showUpdateDialog(info);
    } else if (act === 'dismiss') {
      hideUpdateBanner();
    }
  });

  document.body.appendChild(bar);
  updateBanner = bar;
  requestAnimationFrame(() => bar.classList.add('show'));
}

function hideUpdateBanner() {
  if (!updateBanner) return;
  const el = updateBanner;
  updateBanner = null;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 260);
}

/* ---------- 详情弹窗 ---------- */
function showUpdateDialog(info) {
  const old = document.getElementById('updateDialog');
  if (old) old.remove();

  const assets = (info.assets || []).map(a => `
    <li>
      <span class="ua-name">${escapeHtml(a.name)}</span>
      <span class="ua-size">${(a.size / 1048576).toFixed(1)} MB</span>
      <button class="ub-btn" data-url="${escapeHtml(a.url)}">下载</button>
    </li>`).join('');

  const dlg = document.createElement('div');
  dlg.id = 'updateDialog';
  dlg.className = 'modal-mask';
  dlg.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">版本更新</span>
        <button class="ub-btn icon" data-act="close" title="关闭">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="modal-body">
        <p class="ud-ver">当前 <b>${info.current}</b> → 最新 <b class="ud-new">${info.latest}</b></p>
        ${info.publishedAt ? `<p class="ud-date">发布于 ${new Date(info.publishedAt).toLocaleDateString('zh-CN')}</p>` : ''}
        ${info.notes ? `<pre class="ud-notes">${escapeHtml(info.notes)}</pre>` : ''}
        <div class="ud-assets">
          <div class="ud-assets-title">下载</div>
          <ul class="ua-list">${assets || '<li class="ua-empty">该版本没有附件</li>'}</ul>
        </div>
      </div>
      <div class="modal-foot">
        <button class="ub-btn" data-act="close">稍后再说</button>
        <button class="ub-btn primary" data-act="release">打开发布页</button>
      </div>
    </div>
  `;

  dlg.addEventListener('click', e => {
    const urlBtn = e.target.closest('[data-url]');
    if (urlBtn) { window.api.openExternal(urlBtn.dataset.url); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'close') dlg.remove();
    if (btn.dataset.act === 'release') window.api.openExternal(info.releaseUrl);
  });

  document.body.appendChild(dlg);
  requestAnimationFrame(() => dlg.classList.add('show'));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- 菜单入口：帮助 → 检查更新 ---------- */
window.api.on('app:checkUpdate', async () => {
  const r = await checkUpdate(true);
  if (!r) { toast('无法连接更新服务'); return; }
  if (!r.ok) { toast('检查失败：' + (r.error || '未知错误')); return; }
  if (r.hasUpdate) showUpdateDialog(r);
  else toast('已是最新版本 ' + r.current);
});

/* ---------- 关于对话框 ---------- */
window.api.on('app:about', () => {
  const old = document.getElementById('aboutDialog');
  if (old) old.remove();

  let ver = '—';
  try { ver = window.api.version ? window.api.version() : '—'; } catch (e) {}

  const dlg = document.createElement('div');
  dlg.id = 'aboutDialog';
  dlg.className = 'modal-mask';
  dlg.innerHTML = `
    <div class="modal" style="width:min(400px,100%)">
      <div class="modal-body" style="text-align:center;padding:30px 24px 24px">
        <div class="about-logo">
          <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>
        </div>
        <div class="about-name">轻墨 QingMo</div>
        <div class="about-ver">版本 ${ver}</div>
        <p class="about-desc">简洁轻量的跨平台 Markdown 编辑器<br>左边写，右边即时看到成品</p>
        <div class="about-links">
          <button class="ub-btn" data-url="https://github.com/engrecho/qingmo">项目主页</button>
          <button class="ub-btn" data-url="https://github.com/engrecho/qingmo/releases">版本发布</button>
        </div>
      </div>
      <div class="modal-foot" style="justify-content:center">
        <button class="ub-btn" data-act="close">关闭</button>
      </div>
    </div>
  `;

  dlg.addEventListener('click', e => {
    const u = e.target.closest('[data-url]');
    if (u) { window.api.openExternal(u.dataset.url); return; }
    if (e.target.closest('[data-act="close"]')) dlg.remove();
  });

  document.body.appendChild(dlg);
  requestAnimationFrame(() => dlg.classList.add('show'));
});
