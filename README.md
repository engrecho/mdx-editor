# MDX — Markdown 编辑器

简洁轻量的跨平台 Markdown 编辑器，左侧编辑、右侧实时预览，支持快捷插入表格 / 引用 / 代码块等语法。

## 特性

- **实时预览**：输入即渲染，80ms 防抖不卡顿
- **三种视图**：仅编辑 / 分栏（可拖拽分隔条）/ 仅预览
- **快捷插入**：表格、引用、代码块、有序/无序/任务列表、分隔线、链接、图片
- **智能包裹**：选中文字后按 `Ctrl+B` 自动加粗，再次按下取消包裹
- **智能表格**：选中若干行按 `Ctrl+T`，自动生成表格（首行为表头）
- **块级标题**：`Ctrl+Alt+1/2/3` 切换 H1/H2/H3，再按一次降级为正文
- **自动补全括号**：输入 `(`、`*`、`` ` `` 等自动配对
- **Tab 缩进**：`Tab` / `Shift+Tab` 增减缩进
- **自动暂存**：编辑内容实时写入 localStorage，意外关闭不丢稿
- **导出 HTML**：一键生成带样式的独立 HTML（含深色适配）
- **深色模式**：跟随系统，可 `Ctrl+D` 手动切换
- **最近文件**：菜单记录最近打开的 10 个文档
- **中文友好**：全中文菜单、状态栏显示行/列位置、字数统计

## 快捷键

| 操作 | Windows | macOS |
| --- | --- | --- |
| 新建 / 打开 / 保存 | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` | `Cmd+N` / `Cmd+O` / `Cmd+S` |
| 另存为 / 导出 HTML | `Ctrl+Shift+S` / `Ctrl+Shift+E` | `Cmd+Shift+S` / `Cmd+Shift+E` |
| 粗体 / 斜体 / 行内代码 | `Ctrl+B` / `Ctrl+I` / `Ctrl+E` | 同左（Cmd） |
| 删除线 | `Ctrl+Shift+X` | `Cmd+Shift+X` |
| H1 / H2 / H3 | `Ctrl+Alt+1/2/3` | `Cmd+Alt+1/2/3` |
| 插入表格 | `Ctrl+T` | `Cmd+T` |
| 插入引用 / 代码块 | `Ctrl+Shift+Q` / `Ctrl+Shift+K` | 同左（Cmd） |
| 有序 / 无序 / 任务列表 | `Ctrl+Shift+7/8/9` | 同左（Cmd） |
| 分隔线 / 链接 / 图片 | `Ctrl+Shift+M` / `Ctrl+Shift+L` / `Ctrl+Shift+I` | 同左（Cmd） |
| 视图：编辑 / 分栏 / 预览 | `Ctrl+1/2/3` | `Cmd+1/2/3` |
| 深色模式 | `Ctrl+D` | `Cmd+D` |
| 查找 | `Ctrl+F` | `Cmd+F` |

## 运行

```bash
npm install
npm start          # 开发运行
```

> 若在 WorkBuddy / VSCode 内置终端中运行，需先清除 `ELECTRON_RUN_AS_NODE`：
> `run.bat` 已自动处理。

## 打包

```bash
npm run pack:win    # Windows：NSIS 安装包 + 绿色便携版 → release-v2/
npm run pack:mac    # macOS DMG（必须在 mac 上执行）
npm run pack        # 双平台（需 mac）
```

产物位于 `release-v2/` 目录。

### macOS 交叉打包（在 Windows 上产出 mac zip）

`.dmg` 必须用 macOS 的 `hdiutil`，无法交叉生成。但 **`.zip` 形式的 `.app` 可以**，
本项目内置了一套纯 JS 管线绕过平台限制：

```bash
npm run mac:fetch    # 下载 Electron mac 运行时（npmmirror 镜像）
npm run pack:mac-x   # 组装 MDX.app → 压缩 → release-v2/mac/
```

产出 `MDX-1.0.0-mac-arm64.zip`（Apple Silicon）与 `MDX-1.0.0-mac-x64.zip`（Intel）。

原理与三个必须绕开的坑：

| 限制 | 现象 | 应对 |
| --- | --- | --- |
| electron-builder 硬性检查 | `Build for macOS is supported only on macOS` | 不用它，手动组装 |
| Windows 自带 tar 拒绝 mac zip | `This does not look like a tar archive` | 自写 `unzip.js` / `zip.js` 纯 JS 解压压缩 |
| Node 的 `fs.cpSync` 在中文路径崩溃 | 进程被强杀，`0xC0000409` | 手写 `readdirSync` + `copyFileSync` 递归 |

组装流程：解压官方 Electron 运行时 → 删 `default_app.asar` → 注入自己的 `app.asar`
→ 重命名可执行文件为 `MDX` → 改 `Info.plist` 标识 → 压缩（保留 Unix 可执行位）。

> **未签名**：产物没有 Apple 开发者签名。首次打开需右键选「打开」，
> 或 `xattr -dr com.apple.quarantine /Applications/MDX.app`。
> 如需免警告分发，得在 mac 上用 `codesign` + 公证（需付费开发者账号）。

## 技术栈

| 模块 | 选型 |
| --- | --- |
| 桌面外壳 | Electron 33 |
| 编辑器内核 | CodeMirror 6（markdown 语法高亮） |
| 渲染 | marked + DOMPurify（XSS 防护） |
| 打包 | esbuild（渲染层）+ electron-builder |
| 前端 | 原生 JS + CSS 变量，无框架 |

## 设计说明

**图标**：全部为手写 SVG symbol（24 网格 / 1.6 描边 / 圆角端点），以 `<use href="#id">` 引用。
不使用 emoji——emoji 依赖系统字体，在小尺寸下笔画粘连、视觉重量不均。

**配色**：9 级中性色阶（`--c-0` ~ `--c-900`）+ 单一强调色 `--accent`。
暗色主题只覆盖 CSS 变量，不改任何结构规则。

**排版**：预览区 15.5px / 行高 1.85 / 左右 46px 留白；标题加负字距收紧字面；
状态栏数字用 `font-variant-numeric: tabular-nums` 防跳动。

**层级**：边框从重到轻为 `1px 分隔条` < `1px 边框` < `分组容器底色`。
工具栏分组 hover 才显边框，常态降低视觉噪声。

### 设计走查

渲染层支持 `?shot=1&theme=light|dark` 参数，注入演示文档并强制主题，
用于无头浏览器截图核对设计：

```bash
msedge --headless=new --screenshot=out.png --window-size=1440,900 \
  "file:///path/to/index.html?shot=1&theme=dark"
```

## 项目结构

```
mdx-editor/
├─ src/
│  ├─ main/
│  │  ├─ main.js        # 主进程：窗口、菜单、文件 IPC
│  │  └─ preload.js     # 安全桥接（contextIsolation）
│  └─ renderer/
│     ├─ index.html
│     ├─ style.css      # 亮/暗双主题 CSS 变量
│     ├─ app.js         # 编辑器 + 预览 + 插入逻辑
│     └─ app.bundle.js  # esbuild 产物（勿手改）
├─ scripts/
│  └─ build-renderer.js
└─ run.bat
```

## 安全说明

- `contextIsolation: true` + `nodeIntegration: false`，渲染层无 Node 权限
- 所有文件操作走 preload 白名单 IPC
- 预览 HTML 经 DOMPurify 净化，防止 XSS
- CSP 限制脚本来源，仅允许本地资源