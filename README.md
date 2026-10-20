# 轻墨 QingMo

> 简洁轻量的跨平台 Markdown 编辑器 —— 左边写，右边即时看到成品。

Windows / macOS 双端运行，支持实时预览、快捷插入、多标签与自动更新检测。

**仓库**：[github.com/engrecho/qingmo](https://github.com/engrecho/qingmo)
**版本**：v1.2.0

---

## 目录结构

```
qingmo/
├── dev/                      ← 【开发目录】改代码看这里
│   ├── src/                    源代码
│   │   ├── main/                 Electron 主进程：窗口、菜单、文件读写、更新检测
│   │   │   ├── main.js
│   │   │   └── preload.js          安全桥接（contextBridge 白名单）
│   │   └── renderer/             渲染进程：编辑器 + 预览 + 界面
│   │       ├── index.html           页面结构（含 SVG 图标雪碧图）
│   │       ├── style.css           全部样式（设计令牌 + 亮/暗双主题）
│   │       ├── app.js              核心逻辑（多标签、编辑、预览、命令）
│   │       ├── update.js           版本更新检测与提示 UI
│   │       ├── app.bundle.js       esbuild 产物（勿手改）
│   │       └── update.bundle.js    esbuild 产物（勿手改）
│   │
│   ├── scripts/                构建脚本
│   │   ├── build-renderer.js       渲染层打包
│   │   ├── gen-icons.js           SVG → 多尺寸 PNG
│   │   ├── png-tool.js            纯 JS PNG 编解码与缩放
│   │   ├── make-ico.js            ICO / ICNS 封装
│   │   ├── clean-cache.js         清理构建缓存
│   │   ├── publish.js             产物同步到 release/
│   │   ├── release.js             发布 GitHub Release
│   │   └── mac/                    macOS 交叉打包管线
│   │       ├── fetch-runtime.js      下载 Electron mac 运行时
│   │       └── build-mac.js          组装 .app
│   │
│   ├── build/icons/            图标源文件（logo.svg）与生成产物
│   ├── package.json
│   ├── package-lock.json
│   └── run.bat                 Windows 一键启动
│
├── release/                 ← 【发布目录】拿去用，别改
│   ├── windows/                Windows 安装版 + 便携版
│   │   ├── 轻墨 Setup 1.2.0.exe
│   │   ├── 轻墨 1.2.0.exe
│   │   ├── portable/              免安装目录版
│   │   └── 说明.md
│   ├── macos/                  macOS 双架构 zip
│   │   ├── QingMo-1.2.0-mac-arm64.zip
│   │   ├── QingMo-1.2.0-mac-x64.zip
│   │   └── 说明.md
│   └── README.md
│
├── docs/                    ← 【文档】
│   ├── 使用手册.md             给使用者：快捷键、语法、技巧、FAQ
│   ├── 开发指南.md             给开发者：架构、打包、踩坑
│   ├── Windows使用说明.md
│   └── macOS使用说明.md
│
├── .gitignore
├── RELEASE_NOTES.md         发布说明
└── README.md
```

**两类目录的区别**：

| 目录 | 性质 | 你要做什么 |
| --- | --- | --- |
| `dev/` | 开发 | 想改功能才动，需要 Node 环境 |
| `release/` | 发布 | 直接使用，或交给别人 |

---

## 一、快速使用（只下载使用）

到 [`release/`](release/) 目录取文件：

**Windows**

| 文件 | 说明 |
| --- | --- |
| `轻墨 Setup 1.2.0.exe` | **安装版**（推荐）。双击安装，可选目录，创建桌面快捷方式 |
| `轻墨 1.2.0.exe` | 单文件版。免安装，但**首次启动要等 5-10 秒**（内部要解压） |
| `portable/轻墨.exe` | 免安装目录版。**双击立即启动**，整个文件夹一起复制 |

**macOS**

| 文件 | 适用机型 |
| --- | --- |
| `QingMo-1.2.0-mac-arm64.zip` | Apple Silicon（M1/M2/M3/M4）—— 大多数人选这个 |
| `QingMo-1.2.0-mac-x64.zip` | Intel 芯片 |

macOS **首次必须右键点击 → 打开**（未签名，Gatekeeper 会拦截）。详见
[`docs/macOS使用说明.md`](docs/macOS使用说明.md)。

---

## 二、macOS 自己打包（重要）

> **如果你手上的 mac 包打不开，或者想要正式签名的版本，请在 Mac 上自己打包。**
> 交叉打包产出的 zip 未经 Apple 签名与公证，只能靠「右键打开」绕过。

### 方案 A：在 Mac 上打包（推荐，能出 .dmg）

```bash
git clone https://github.com/engrecho/qingmo.git
cd qingmo/dev
npm install
npm run pack:mac
```

产物在 `dev/../build-output/mac/`（.dmg 与 .zip）。

### 方案 B：在 Mac 上打 zip（只需 Electron 运行时）

```bash
cd qingmo/dev
npm install
npm run mac:fetch     # 下载 Electron mac 运行时
npm run pack:mac-x    # 组装 .app 并压缩
```

### 方案 C：在 Windows 上交叉打包（无法出 .dmg）

```bash
cd qingmo/dev
npm install
npm run mac:fetch
npm run pack:mac-x
```

**为什么 Windows 打不出 .dmg**：`.dmg` 需要 macOS 的 `hdiutil` 磁盘镜像工具，
Windows 上没有对应实现。`.app` 的 zip 可以交叉产出。

### 交叉打包的三个技术限制

`dev/scripts/mac/build-mac.js` 绕开了这些坑，改动前请先看：

| 限制 | 现象 | 应对 |
| --- | --- | --- |
| electron-builder 平台检查 | `Build for macOS is supported only on macOS` | 不用它，手动组装 |
| Windows 自带 tar 拒绝 mac zip | `This does not look like a tar archive` | 自写 ZIP 读写 |
| **mac 框架有 14 个符号链接** | 解压再压缩 → 应用报「已损坏」 | **直接改官方 zip 里的条目**，不落盘 |

第三条尤其关键：Electron 的 `Electron Framework.framework/Versions/Current` 等
是符号链接，且目标必须是**相对路径**。Windows 无法创建符号链接，
一旦「解压 → 修改 → 重新压缩」，链接必然丢失或被转成绝对路径，
mac 拿到后加载框架失败 —— 就是「应用已损坏」的真正原因。

所以现在的做法是：**读官方 zip → 替换 app.asar / 改 Info.plist / 换图标 → 原样复制其余条目**，
目录结构、符号链接、权限位全部保持原样。

### 签名与公证（消除「已损坏」提示）

要彻底消除 Gatekeeper 拦截，需要 Apple 付费开发者账号（$99/年）：

```bash
# 在 Mac 上，配置好证书后
codesign --deep --force --verbose --options runtime \
  --sign "Developer ID Application: YOUR_NAME (TEAMID)" \
  QingMo.app
xcrun notarytool submit QingMo.zip --keychain-profile "AC_PROFILE" --wait
xcrun stapler staple QingMo.app
```

未签名的版本只能靠用户手动「右键打开」放行。

---

## 三、开发者指南

```bash
cd dev
npm install
npm start              # 启动应用
```

改完前端代码要重新打包渲染层：

```bash
npm run build:renderer
```

### 全部脚本

| 命令 | 作用 |
| --- | --- |
| `npm start` | 启动应用 |
| `npm run build:renderer` | 打包渲染层（app.js + update.js） |
| `npm run pack:win` | 打包 Windows（安装版 + 便携版） |
| `npm run pack:mac` | 打包 macOS（**需在 Mac 上执行**，出 .dmg） |
| `npm run pack:mac-x` | 打包 macOS zip（可交叉执行） |
| `npm run mac:fetch` | 下载 Electron mac 运行时 |
| `npm run gen:icons` | 从 logo.svg 生成全套图标 |
| `npm run cache:clean` | 清理构建缓存（`-- --all` 连运行时一起清） |
| `npm run publish` | 把产物同步到 `release/` |
| `npm run release` | 发布 GitHub Release |

### 发布 GitHub Release

```bash
# 1. 准备 PAT（需 repo 权限），设置环境变量
export GITHUB_TOKEN=ghp_xxxxxxxxxxxx

# 2. 打包并同步到 release/
npm run pack:win
npm run publish:win

# 3. 发布
node scripts/release.js --tag v1.2.0 --notes-file ../RELEASE_NOTES.md
```

脚本会：创建 Release（已存在则复用）→ 上传 `release/` 下的所有 `.exe` / `.zip`
→ 更新发布说明。

---

## 四、版本更新检测

应用启动 2.5 秒后自动检查 GitHub Releases，有新版时顶部弹出提示条。

- 检查接口：`GET https://api.github.com/repos/engrecho/qingmo/releases/latest`
- 检查频率：每 24 小时一次（记录在 localStorage）
- 手动检查：**帮助 → 检查更新**
- 提示条可直接「前往下载」（自动匹配当前平台的资源）
- 「查看详情」弹窗展示版本对比、更新说明、全部附件列表

**更新逻辑在** `dev/src/renderer/update.js`（UI）与
`dev/src/main/main.js`（`app:checkUpdate` IPC）。

---

## 五、设计说明

**图标**：全部为手写 SVG symbol（24 网格 / 1.6 描边 / 圆角端点），
以 `<use href="#id">` 引用。不使用 emoji —— emoji 依赖系统字体，
在小尺寸下笔画粘连、视觉重量不均。

**配色**：9 级中性色阶（`--c-0` ~ `--c-900`）+ 单一强调色 `--accent`。
暗色主题只覆盖 CSS 变量，不改任何结构规则。

**排版**：预览区 15.5px / 行高 1.85 / 左右 46px 留白；标题加负字距收紧字面；
状态栏数字用 `tabular-nums` 防跳动。

**层级**：边框从重到轻为 `1px 分隔条` < `1px 边框` < `分组容器底色`。
工具栏分组 hover 才显边框，常态降低视觉噪声。

### 设计走查

```bash
msedge --headless=new --screenshot=out.png --window-size=1440,900 \
  "file:///path/to/dev/src/renderer/index.html?shot=1&theme=dark"
```

| 参数 | 作用 |
| --- | --- |
| `shot=1` | 注入演示文档与多标签数据 |
| `theme=light\|dark` | 强制主题，跳过 localStorage |
| `sb=collapsed` | 侧边栏折叠态 |

---

## 六、安全

- **渲染进程无 Node 权限** —— `contextIsolation: true` + `nodeIntegration: false`
- **文件操作走白名单** —— 只有 preload 显式暴露的方法能被调用
- **预览防 XSS** —— HTML 经 DOMPurify 净化，恶意脚本不会执行
- **CSP 限制** —— `script-src 'self'`，禁止内联脚本
- **不联网** —— 除更新检查外无任何网络请求，不收集任何数据

---

## 七、文档

| 文档 | 适合谁 |
| --- | --- |
| [`docs/使用手册.md`](docs/使用手册.md) | 使用者 —— 快捷键、语法、技巧、FAQ |
| [`docs/开发指南.md`](docs/开发指南.md) | 开发者 —— 架构、打包、踩坑记录 |
| [`docs/Windows使用说明.md`](docs/Windows使用说明.md) | Windows 用户 —— 安装与卸载 |
| [`docs/macOS使用说明.md`](docs/macOS使用说明.md) | macOS 用户 —— 安装、芯片选择、签名 |

---

**轻墨 QingMo** · v1.2.0 · MIT License
