# 轻墨 QingMo

> 简洁轻量的跨平台 Markdown 编辑器 —— 左边写，右边即时看到成品。

Windows / macOS 双端运行，支持实时预览与快捷插入 Markdown 语法。

---

## 一、这是什么

轻墨是一个**开箱即用**的 Markdown 编辑器：

- **左侧写 Markdown，右侧实时预览** —— 打字即渲染，80ms 防抖不卡顿
- **一键插入格式** —— 表格、引用、代码块、列表、分隔线、链接、图片
- **三视图切换** —— 仅编辑 / 分栏 / 仅预览，中间分隔条可拖拽
- **深色模式** —— 跟随系统，`Ctrl+D` 手动切换
- **不会丢稿** —— 内容实时暂存，意外关闭可恢复

无需注册、无需联网、无需配置，打开就能写。

---

## 二、快速开始（只下载使用）

### Windows

到 [`dist/windows/`](dist/windows/) 目录取文件：

| 文件 | 说明 |
| --- | --- |
| `轻墨 Setup 1.1.0.exe` | **安装版**（推荐）。双击安装，可选安装目录，自动创建桌面快捷方式 |
| `轻墨 1.1.0.exe` | **便携版**。免安装，双击即用，适合放 U 盘 |

> 提示：Windows 可能提示「未知发布者」，这是因为没有购买代码签名证书。
> 点「更多信息」→「仍要运行」即可。

### macOS

到 [`dist/macos/`](dist/macos/) 目录，按你的 Mac 选：

| 文件 | 适用机型 |
| --- | --- |
| `QingMo-1.1.0-mac-arm64.zip` | Apple Silicon（M1/M2/M3/M4 系列）—— 大多数人选这个 |
| `QingMo-1.1.0-mac-x64.zip` | Intel 芯片（较老的机型） |

**安装步骤**：

1. 解压 zip，得到 `QingMo.app`（访达里显示为「轻墨」）
2. 把 `QingMo.app` 拖进「应用程序」文件夹
3. **首次打开必须右键点击** `QingMo.app` → 选择「打开」→ 在弹窗中再点「打开」

> 为什么不能双击？因为应用没有 Apple 签名和公证，macOS 的 Gatekeeper 会拦截。
> 右键打开一次后，以后就可以正常双击了。
>
> 如果还是打不开，在终端执行：
> ```bash
> xattr -dr com.apple.quarantine /Applications/QingMo.app
> ```
>
> 想要免警告的分发体验，需要在 Mac 上用 Apple 开发者账号签名并公证。

---

## 三、日常使用

### 3.1 界面说明

```
┌──────────────────────────────────────────────────┐
│ 轻墨  文档名.md        [工具栏图标]      [◫|◐]    │  ← 标题栏
├────────────────────┬─────────────────────────────┤
│                    ┃                             │
│   Markdown         ┃      预览                    │
│   （编辑区）        ┃   （渲染结果）               │
│                    ┃                             │
│                    ┃                  ← 拖这条线 │
├────────────────────┴─────────────────────────────┤
│ 文件路径 · 行 12, 列 4      已保存  1,284 字  96 行 │  ← 状态栏
└──────────────────────────────────────────────────┘
```

- **右上角三个图标**：仅编辑 / 分栏 / 仅预览
- **中间竖线**：按住拖动可调整两侧比例
- **左下角**：当前文件路径和光标位置
- **右下角**：保存状态、字数、行数

### 3.2 快捷键全表

Windows 用 `Ctrl`，macOS 用 `⌘ Command`（下文统一写作 `Ctrl`）。

#### 文件

| 操作 | 快捷键 |
| --- | --- |
| 新建文档 | `Ctrl+N` |
| 打开文件 | `Ctrl+O` |
| 保存 | `Ctrl+S` |
| 另存为 | `Ctrl+Shift+S` |
| 导出为 HTML | `Ctrl+Shift+E` |

#### 格式

| 操作 | 快捷键 | 提示 |
| --- | --- | --- |
| 加粗 | `Ctrl+B` | 选中文字后按，**再按一次取消加粗** |
| 斜体 | `Ctrl+I` | 同上，可反复切换 |
| 删除线 | `Ctrl+Shift+X` | |
| 行内代码 | `Ctrl+E` | |
| 标题 1 / 2 / 3 | `Ctrl+Alt+1/2/3` | **再按一次降级为正文** |

#### 插入

| 操作 | 快捷键 | 提示 |
| --- | --- | --- |
| 表格 | `Ctrl+T` | **选中多行再按，首行自动作表头** |
| 引用块 | `Ctrl+Shift+Q` | 选中的每行都会加上 `>` |
| 代码块 | `Ctrl+Shift+K` | 选中文本会自动包进代码块 |
| 有序列表 | `Ctrl+Shift+7` | |
| 无序列表 | `Ctrl+Shift+8` | |
| 任务列表 | `Ctrl+Shift+9` | 自动加 `- [ ]` |
| 分隔线 | `Ctrl+Shift+M` | |
| 链接 | `Ctrl+Shift+L` | 选中文字作链接文字 |
| 图片 | `Ctrl+Shift+I` | |

#### 视图

| 操作 | 快捷键 |
| --- | --- |
| 仅编辑 / 分栏 / 仅预览 | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| 深色模式 | `Ctrl+D` |
| 查找替换 | `Ctrl+F` |

### 3.3 三个实用技巧

**① 选中多行变表格**

选中这几行：

```
产品
价格
备注
```

按 `Ctrl+T`，立刻变成：

```markdown
| 产品 | 价格 | 备注 |
| --- | --- | --- |
|  |  |  |
```

**② 格式可反复切换**

选中「重点」按 `Ctrl+B` 变粗体，**再按一次**恢复原样 —— 不会变成 `****重点****`。

**③ 草稿自动暂存**

编辑内容实时写入本地暂存，即使意外关闭，下次打开能恢复。
正式保存（`Ctrl+S`）后暂存清除。状态栏显示「未保存」时有橙色圆点提示。

---

## 四、目录结构说明

```
qingmo/
├── dist/                    ← 【现成版本】直接拿去用，不用碰
│   ├── windows/               Windows 安装版 + 便携版
│   └── macos/                 macOS 双架构 zip
│
├── src/                     ← 【开发】源代码
│   ├── main/                  Electron 主进程：窗口、菜单、文件读写
│   │   ├────── main.js
│   │   └── preload.js          安全桥接（白名单 IPC）
│   └── renderer/              渲染进程：编辑器 + 预览 + 界面
│       ├── index.html          界面结构（含 SVG 图标雪碧图）
│       ├── style.css           全部样式（亮/暗双主题）
│       ├── app.js              核心逻辑
│       └── app.bundle.js       打包产物（勿手改）
│
├── scripts/                 ← 【开发】构建脚本
│   ├── build-renderer.js      渲染层打包（esbuild）
│   └── mac/                   macOS 交叉打包管线
│       ├───── fetch-runtime.js     下载 Electron mac 运行时
│       ├── unzip.js             纯 JS ZIP 解压
│       ├── zip.js               纯 JS ZIP 压缩
│       └── build-mac.js         组装 .app
│
├── docs/                    ← 【文档】
│   ├── 使用手册.md             详细使用说明
│   └── 开发指南.md             如何从源码开发
│
├── .cache/                 ← 【缓存】可随时删，会自动重建
│   ├── electron-mac/          Electron mac 运行时（约 195MB）
│   └── mac-build/             打包临时目录（每次几百MB，纯垃圾）
│
├── _archive/                ← 【历史】旧版本产物，仅备查
│
├── package.json             项目配置
├── run.bat                  Windows 一键启动
└── README.md                本文件
```

**三类文件的区别**：

| 目录 | 性质 | 你需要做什么 |
| --- | --- | --- |
| `dist/` | 现成版本 | 直接使用，无需任何操作 |
| `src/` `scripts/` | 源代码 | 想改功能才动，需要 Node 环境 |
| `.cache/` | 构建缓存 | 可随时删，会自动重建 |
| `_archive/` | 历史产物 | 不用管，可删 |

### 清理缓存

mac 打包会产生几百 MB 的临时文件，清一下：

```bash
npm run cache:clean          # 只删临时目录，保留运行时（推荐）
npm run cache:clean -- --all # 连运行时一起删，回收约 195MB
```

运行时删掉后，下次打包前需重新执行 `npm run mac:fetch`。

---

## 五、从源码运行（开发者）

需要 [Node.js](https://nodejs.org/) 18 以上。

```bash
npm install     # 安装依赖
npm start       # 启动应用
```

重新打包：

```bash
npm run pack:win        # Windows 安装版 + 便携版
npm run mac:fetch       # 下载 mac 运行时（只需一次）
npm run pack:mac-x      # macOS 双架构 zip
```

详见 [`docs/开发指南.md`](docs/开发指南.md)。

---

## 六、安全说明

轻墨在设计上做了几件事：

- **渲染进程无 Node 权限** —— `contextIsolation: true` + `nodeIntegration: false`
- **文件操作走白名单** —— 只有 preload 显式暴露的方法能被调用
- **预览防 XSS** —— HTML 经 DOMPurify 净化，恶意脚本不会执行
- **CSP 限制** —— 只允许加载本地资源

打开的 `.md` 文件不会自动执行任何内容。

---

## 七、应用图标

图标源文件：`build/icons/logo.svg`（1024×1024 矢量，3 个路径）。

```bash
npm run gen:icons     # 重新生成全套图标
```

产出：

| 文件 | 用途 |
| --- | --- |
| `icon.ico` | Windows exe/快捷方式/任务栏（7 个尺寸） |
| `icon.icns` | macOS 应用图标（11 种规格） |
| `icon-16 ~ 1024.png` | 界面内嵌、文档配图 |
| `icon-64.base64.txt` | 标题栏内嵌用base64 |

图标出现在这些位置：Windows 任务栏与 Alt-Tab、桌面快捷方式、
开始菜单、标题栏左上角、macOS Dock 与访达。

**为什么不用现成工具**：环境里没有 Inkscape / ImageMagick / rsvg-convert。
所以用 Edge 无头渲染出PNG，再用自写的 `png-tool.js` 缩放、`make-ico.js`
封装 ICO/ICNS。两条限制：Edge 在小于 128px 的窗口不渲染，故统一从
1024母图缩放；Node 调 Edge 会超时（ETIMEDOUT），故渲染环节走 Bash。

---

## 八、反馈

发现问题或想要新功能，欢迎到
[GitHub 仓库](https://github.com/engrecho/qingmo) 提 Issue。

---

**轻墨 QingMo** · v1.1.0 · MIT License
