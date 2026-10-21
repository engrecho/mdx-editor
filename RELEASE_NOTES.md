# 轻墨 QingMo v1.3.0

简洁轻量的跨平台 Markdown 编辑器 —— 左边写，右边即时看到成品。

## 新增：预览区直接编辑

**写完初稿后，可以在预览区直接改字，不用再盯着那些 `#`、`**`、`- ` 符号。**

按 `Ctrl+Shift+P`（或点标题栏的铅笔图标，或菜单「视图 → 预览区直接编辑」）打开。

开启后：

- 预览区变成可以直接打字
- 鼠标移到某一段上有一圈淡描边，提示「这块能改」
- 改字 → 左边源码实时同步
- 勾选任务列表的方框 → 源码里的 `[ ]` 变成 `[x]`
- 点链接用浏览器新标签打开，不会打断当前文档

**适合什么场景**：通读润色。写结构（插标题、表格、代码块）还是用源码模式，
两边配合最顺手。

### 用法速查

| 操作 | 效果 |
| --- | --- |
| 改段落里的字 | 正常同步到源码 |
| 选中文本 | 就是普通的文本选择 |
| 按 `Enter` | 新起一段（自动补 Markdown 需要的空行） |
| 光标在块首按 `Backspace` | 并回上一段 |
| 粘贴 | 只取纯文本，不带网页样式 |
| 点链接 | 浏览器新标签打开 |

### 已知局限

- 粒度是**块**，不是字符。改一段时这一段的 Markdown 会被重新生成，
  行内标记（`**粗体**`、`[链接](...)`）会保留，但不是逐字符还原。
- 在预览区**不能插结构** —— 标题、表格、代码块这类要用工具栏按钮，
  或切到源码模式。这是有意的设计，避免误操作把文档改乱。
- 代码块里能正常打字，但代码块的语言标识（```` ```js ````）不会变。

## 改进：中间文件不再污染项目根目录

构建产物、临时文件、待删除暂存区**全部收进 `.cache/`**：

```
.cache/
├── build/          构建产物（electron-builder 输出）
├── electron-mac/   Electron mac 运行时缓存
├── icons/          图标生成临时文件
├── scratch/        一次性脚本与调试产物
└── trash/          待删除暂存区
```

现在项目根目录只剩源码（`dev/`）、成品（`release/`）和文档，
`git status` 干干净净，`ls` 也不会被一堆 `build-*` 淹没。

## 下载

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `QingMo-1.3.0-win-setup.exe` | 安装版（推荐） |
| Windows | `QingMo-1.3.0-win-portable.exe` | 单文件版，首次启动需解压 |
| macOS (Apple 芯片) | `QingMo-1.3.0-mac-arm64.zip` | M1/M2/M3/M4 |
| macOS (Intel) | `QingMo-1.3.0-mac-x64.zip` | 较老的 Intel 机型 |

### macOS 首次打开

应用未做 Apple 签名与公证，Gatekeeper 会拦截，**必须右键点击 → 打开**。
若仍打不开：

```bash
xattr -dr com.apple.quarantine /Applications/QingMo.app
```

## 完整快捷键

| 功能 | 快捷键 |
| --- | --- |
| 视图切换（编辑 / 分栏 / 预览） | `Ctrl+1` / `2` / `3` |
| **预览区直接编辑** | **`Ctrl+Shift+P`** |
| 深色模式 | `Ctrl+D` |
| 保存 | `Ctrl+S` |
| 加粗 / 斜体 / 删除线 | `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` |
| 行内代码 | `Ctrl+E` |
| 插入表格 | `Ctrl+T` |
| 插入引用 | `Ctrl+Shift+Q` |
| 代码块 | `Ctrl+Shift+K` |
| 无序 / 有序 / 任务列表 | `Ctrl+Shift+8` / `7` / `9` |
| 分隔线 | `Ctrl+Shift+M` |
| 链接 / 图片 | `Ctrl+Shift+L` / `Ctrl+Shift+I` |
| 导出 HTML | `Ctrl+Shift+E` |
| 折叠侧边栏 | `Ctrl+B`（无选区时） |

## 从 1.2.1 升级

直接覆盖安装即可，没有配置迁移。

v1.2.1 修复的启动崩溃问题（`SyntaxError: Unexpected reserved word`）
在 1.3.0 里继续有效。

## 系统要求

- Windows 10 及以上（x64）
- macOS 11 (Big Sur) 及以上
- 无需安装额外依赖，完全离线运行

## 反馈

问题或建议请到 [Issues](https://github.com/engrecho/qingmo/issues) 提单。