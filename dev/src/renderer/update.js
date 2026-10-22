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
          <img src="data:image/png;base64,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" alt="轻墨" width="52" height="52" />
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
