# AGENTS.md — 轻墨 QingMo 开发准则

> 本文件是本仓库的硬性约定。改动代码、打包、发布前先读一遍。

---

## 1. 目录职责三层分离（硬性，不可混放）

| 目录 | 职责 | 何时可删 | 入库 |
|---|---|---|---|
| `dist/` | electron-builder **原始构建输出**：dmg / zip / blockmap，以及打包工作目录 `mac-arm64/轻墨.app` | 可随时删，下次打包重建 | 忽略 |
| `release/macos/`、`release/windows/` | **发布目录 = 最终交付物**，双端分开存放 | 发布完成后即可删 | 忽略 |
| `.cache/` | **纯临时缓存**：Electron 运行时、图标生成中间产物、一次性脚本产物、`trash/` 暂存区、`busy-check.txt` | **随时一键清空** | 忽略 |

硬性要求：

- **交付物（dmg / zip / exe）绝不允许落在 `.cache/`**。它们一律先进 `dist/`，再由 `npm run publish:mac` / `npm run publish:win` 同步进 `release/macos/`、`release/windows/`。
- **`.cache/` 必须能一键清空，且清空不影响任何交付物**。命令：`npm run cache:clean`（想保留 Electron 运行时加快下次打包：加 `-- --keep-runtime`）。
- `.cache/` 与 `dist/` 的职责不可互相顶替：`.cache/` 是「随时可扔的临时物」，`dist/` 是「构建产物但仍属中间层」，`release/` 才是「对外交付」。
- 不要往仓库根目录扔 `build-*` / `dist-*` / `release-*` 之类的临时目录；`dist/` 与 `release/` 是约定内仅有的两个例外。
- 构建产物一律不提交 Git（`dist/`、`release/`、`.cache/` 都在 `.gitignore` 里）。

## 2. 发布目录双端分开

`release/` 是发布文件夹，**MAC 和 WIN 必须分开**，不得混放：

- `release/macos/` —— macOS 交付物：`轻墨-<版本>-mac-<arch>.dmg`（拖拽安装）+ `轻墨-<版本>-mac-<arch>.zip`（免安装）+ `说明.md`
- `release/windows/` —— Windows 交付物：`轻墨-<版本>-win-setup.exe`、`portable/` 目录 + `说明.md`

新增平台时另建 `release/<平台>/`，沿用同样的「publish 脚本同步 → 该平台子目录」模式。

发布到 GitHub 的资产由 `dev/scripts/release.js` 递归扫描 `release/` 收集（只收 `.zip` / `.dmg` / `.exe`，`.blockmap` / `.yml` 是自动更新用的辅助文件，不对外发），因此产物放在子目录里也能被正确发现。

### 2.1 macOS 资产必须同时给 dmg 和 zip

**macOS 的 dmg 和 zip 都要发**，不能只发一个：

| 资产 | 定位 | 理由 |
|---|---|---|
| `.dmg` | 标准安装包 | 拖进 Applications 即可，是 macOS 主流安装路径，也是自动更新能用的格式 |
| `.zip` | 免安装包 | 解压即用，给不想往 Applications 塞东西、或要在多台机器快速分发的用户 |

实现要点：

- `publish.js` 的 mac 分支**两种扩展名都要同步**进 `release/macos/`；
- `release.js` 的 `asciiName()` **按原文件扩展名生成 ASCII 名**，不能写死 `.zip`——写死会把 dmg 传成 `.zip` 名，下载下来就是坏包；
- GitHub 会截断非 ASCII 文件名，所以上传名统一 `QingMo-<版本>-mac-<arch>.<ext>`，中文说明放 label。

## 3. 每次开发完删除临时无用的文件

- 删掉调试脚本、临时输出、过期产物、`.DS_Store` 等。
- 不要把中间产物留在仓库根目录，统一进 `.cache/`（或 `dist/`，按第 1 条的职责归属）。

## 4. 每次需要更新文档

- 代码行为变了就同步更新对应文档（如 `docs/开发指南.md`、`docs/macOS使用说明.md`、`docs/Windows使用说明.md`、`RELEASE_NOTES.md`）。
- 版本号变更要同步四处：`dev/package.json` 的 `version`、`docs/开发指南.md` 的 `CFBundleVersion` / `CFBundleShortVersionString`、`RELEASE_NOTES.md` 标题、`dev/build/icons/` 随包分发的图标（如有）。

## 5. 修改代码时必须区分 Windows / macOS 双端兼容性

路径分隔符（`\` vs `/`）、文件关联 / 默认程序注册、托盘与菜单、代码签名（APPX vs DMG）、shell 调用、快捷键（Ctrl vs Cmd）等都可能存在平台差异，**不要写死单平台假设**。跨平台逻辑不要散落在业务代码里，一律按 5.1 的方式收进平台目录，并尽量在两端都验证。

### 5.1 平台差异代码放哪

**不要在业务代码里散落 `process.platform` 判断**，一律收进平台目录：

```
dev/src/
  main/
    main.js                    跨平台主流程（本文件不出现 process.platform）
    preload.js
    platform/                  ← 主进程的平台差异都在这
      index.js                 统一出口：按 process.platform 装载对应实现
      base.js                  跨平台默认行为（mac / win 共用的那份）
      mac.js                   macOS 专属覆盖
      win.js                   Windows 专属覆盖
  renderer/
    app.js                     跨平台渲染逻辑
    live-edit.js
    update.js
    platform/
      index.js                 平台标识：写 <html data-platform="...">
    styles/                    ← 渲染层的平台差异样式
      common.css               跨平台主体
      mac.css                  macOS 专属
      win.css                  Windows 专属
```

### 5.2 平台层接口（`platform/base.js` 定义）

| 接口 | 作用 | mac | win |
|---|---|---|---|
| `titleBarStyle` | 窗口标题栏样式 | `hiddenInset` | `default` |
| `appMenuItem` | 应用级菜单 | `{role:'appMenu'}` | `null` |
| `quitMenuItem` | 「文件」菜单末尾项 | `{role:'close'}` | `{role:'quit'}` |
| `setAppIcon()` | 任务栏 / Dock 图标 | `app.dock.setIcon` | `app.setIcon` |
| `registerFileOpen()` | 双击文件打开的入口 | open-file 事件 **＋ argv** | argv |
| `quitOnAllWindowsClosed` | 窗口全关是否退出 | `false` | `true` |
| `matchUpdateAsset()` | 更新时匹配哪个资产 | mac 的 zip | win 的 exe |

**注意**：macOS 上「命令行传参」和「Finder 双击」是**两条都要支持**的入口——`open-file` 事件必须**叠加**在 argv 扫描之上，不能二选一（`轻墨.app file.md` 与 Finder 双击是两种不同入口）。

### 5.3 加新平台怎么做

1. 新建 `dev/src/main/platform/<平台>.js`，`require('./base')` 后覆盖差异项；
2. 在 `dev/src/main/platform/index.js` 的 `IMPLS` 里加一条映射；
3. 渲染层加 `dev/src/renderer/styles/<平台>.css`，用 `[data-platform="<值>"]` 限定作用域；
4. 在 `dev/package.json` 的 `build` 里加该平台段（注意 electron-builder **不支持 per-platform `directories`**，分平台输出目录要用 CLI 覆盖 `--config.directories.output=`）。

### 5.4 其他平台注意事项

- 打包输出目录两端共用 `build.directories.output`（指向 `dist/`），因为 electron-builder 的 `MacConfiguration` / `WindowsConfiguration` **不支持 per-platform `directories`**（schema 里是 `additionalProperties: false`），要分平台输出只能用 CLI 覆盖 `--config.directories.output=`。
- mac 包的文件关联依赖 `fileAssociations` + `app.on('open-file')`，Windows 侧是注册表关联，两端都要单独验证。
- `publish.js` 里对中文路径不能用 `fs.cpSync`（Windows 上会崩），已改用手写 `copyFile`。
- 本机跑 Electron 测试前必须清掉 `ELECTRON_RUN_AS_NODE`（本机环境自带 `=1`，会让 `require('electron')` 拿到 undefined）：
  `env -u ELECTRON_RUN_AS_NODE npm run verify:ui -- --no-sandbox --disable-gpu`。

## 6. 提交、推送与发布前先确认

- `git push main`、打 tag、创建 GitHub Release 前**必须先跟用户确认**，不要自己决定。
- commit 前检查暂存区是否夹带凭证：`git diff --staged | grep -iE 'password|token|secret|api[_-]?key|ghp_|github_pat'`。
- 令牌、密码、SSH 私钥一律不写进仓库文件。

## 7. 常用命令速查

```bash
# 打包（mac，产物在 dist/）
bash dev/pack-mac.sh                # 当前架构 dmg + zip
bash dev/pack-mac.sh --both        # arm64 + x64 双架构
bash dev/pack-mac.sh --dmg         # 只打 dmg

# 同步交付物到 release/（双端分开）
cd dev && npm run publish:mac      # dist/ → release/macos/
cd dev && npm run publish:win      # → release/windows/

# 一键清空缓存（不影响交付物）
cd dev && npm run cache:clean
cd dev && npm run cache:clean -- --keep-runtime   # 保留 Electron 运行时

# 发布 GitHub Release（先用 --dry-run 预览清单）
node dev/scripts/release.js --tag v1.5.1 --dry-run
node dev/scripts/release.js --tag v1.5.1
```
