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
