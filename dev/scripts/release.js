#!/usr/bin/env node
/**
 * 发布 GitHub Release
 *
 * 用法：
 *   node scripts/release.js --tag v1.2.0 --notes "更新内容"
 *   node scripts/release.js --tag v1.2.0 --notes-file notes.md
 *
 * 需要环境变量 GITHUB_TOKEN（PAT，需 repo 权限）
 * 或从运维接口取：见 README 的凭据说明
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const util = require('util');

const log = (...a) => console.error(util.format(...a));

const ROOT = path.join(__dirname, '..', '..');
const REL = path.join(ROOT, 'release');
const REPO = 'engrecho/qingmo';

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const TAG = arg('tag');
const ASSET_DIR = arg('assets', REL);

if (!TAG) {
  log('用法: node scripts/release.js --tag v1.2.0 [--notes "..." | --notes-file notes.md]');
  process.exit(1);
}

let notes = arg('notes', '');
const notesFile = arg('notes-file');
if (notesFile) {
  const f = path.join(ROOT, notesFile);
  if (fs.existsSync(f)) notes = fs.readFileSync(f, 'utf-8');
}
if (!notes) {
  const f = path.join(ROOT, 'RELEASE_NOTES.md');
  if (fs.existsSync(f)) notes = fs.readFileSync(f, 'utf-8');
}
if (!notes) notes = `轻墨 ${TAG}`;

/* ---------- HTTP helper ---------- */
function request(method, apiPath, { body, headers = {}, raw } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'QingMo-Release',
        ...headers
      }
    };
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    if (payload) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = payload.length;
    }

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (raw) { resolve({ status: res.statusCode, buf }); return; }
        let data = null;
        try { data = JSON.parse(buf.toString('utf-8')); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}: ${(data && data.message) || buf.toString('utf-8').slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 上传单个 asset（GitHub 需要特殊 upload URL） */
function uploadAsset(uploadUrl, filePath, name) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const url = new URL(uploadUrl);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'User-Agent': 'QingMo-Release'
      }
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else reject(new Error(`上传 ${name} 失败: HTTP ${res.statusCode} ${Buffer.concat(chunks).toString().slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    fs.createReadStream(filePath).pipe(req);
  });
}

/* ---------- 主流程 ---------- */
async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    log('X 缺少 GITHUB_TOKEN 环境变量');
    log('  获取方式：见项目 README 的「发布 Release」章节');
    process.exit(1);
  }
  const auth = { Authorization: `Bearer ${token}` };

  // 1. 收集要上传的文件
  const assets = [];
  const collect = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        // portable/ 目录太大，只上传其中的 exe
        if (e.name === 'portable') continue;
        collect(full, prefix);
      } else if (e.name.endsWith('.exe') || e.name.endsWith('.zip')) {
        assets.push({ path: full, name: e.name, size: fs.statSync(full).size });
      }
    }
  };
  collect(ASSET_DIR, '');

  if (!assets.length) {
    log('X 在 %s 下没找到可上传的 .exe / .zip', ASSET_DIR);
    process.exit(1);
  }

  log('准备上传 %d 个文件:', assets.length);
  assets.forEach(a => log('  %s  (%s MB)', a.name, (a.size / 1048576).toFixed(1)));

  // 2. 创建或复用 release
  let release = null;
  try {
    release = await request('GET', `/repos/${REPO}/releases/tags/${TAG}`, { headers: auth });
    log('\n已存在 release %s，改为追加资产', TAG);
  } catch (e) {
    log('\n创建 release %s ...', TAG);
    release = await request('POST', `/repos/${REPO}/releases`, {
      headers: auth,
      body: {
        tag_name: TAG,
        name: `轻墨 ${TAG.replace(/^v/i, '')}`,
        body: notes,
        draft: false,
        prerelease: false
      }
    });
  }

  // 3. 上传资产
  log('\n上传中...');
  const existing = (release.assets || []).map(a => a.name);
  for (const a of assets) {
    if (existing.includes(a.name)) {
      log('  跳过（已存在）:', a.name);
      continue;
    }
    const created = await request('POST', `/repos/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(a.name)}`, {
      headers: auth,
      body: { name: a.name, label: a.name }
    });
    await uploadAsset(created.upload_url, a.path, a.name);
    log('  ✓', a.name);
  }

  // 4. 更新说明（若有）
  await request('PATCH', `/repos/${REPO}/releases/${release.id}`, {
    headers: auth,
    body: { body: notes }
  });

  log('\n完成: %s', release.html_url);
}

main().catch(e => {
  log('X %s', e.message);
  process.exit(1);
});
