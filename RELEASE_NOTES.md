# 轻墨 QingMo v1.2.1

简洁轻量的跨平台 Markdown 编辑器 —— 左边写，右边即时看到成品。

## 修复

**Windows / macOS 启动即崩溃（`SyntaxError: Unexpected reserved word`）**

从 v1.2.0 起，应用主进程在启动阶段就抛出 JavaScript 语法错误。Windows 上
弹出「A JavaScript error occurred in the main process」对话框后立即退出，
macOS 上则直接打不开。

根因是主进程里一行 URL 校验正则写坏了：

```js
// 错误（v1.2.0）
if (typeof url === 'string' && /^https:///////.test(url)) {

// 正确（v1.2.1）
if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
```

原写法里第 2 个斜杠提前结束了正则字面量，后面的 `.test(url)` 被解析成
除法运算，导致整个文件语法结构错位，`await` 落到了非 async 上下文，
Node 直接拒绝加载。

修复后除了恢复正常启动，还收紧了外部链接的协议白名单 ——
现在只接受 `http://` 和 `https://`，`file://`、`javascript:` 这类协议
会被拒绝，避免被用来打开本地文件或注入脚本。

## 升级方式

重新下载对应平台的包覆盖即可。

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `QingMo-1.2.1-win-setup.exe` | 安装版（推荐） |
| Windows | `QingMo-1.2.1-win-portable.exe` | 单文件版，首次启动需解压 |
| Windows | `release/windows/portable/轻墨.exe` | 免安装目录版，双击即开 |
| macOS (Apple 芯片) | `QingMo-1.2.1-mac-arm64.zip` | M1/M2/M3/M4 |
| macOS (Intel) | `QingMo-1.2.1-mac-x64.zip` | 较老的 Intel 机型 |

### macOS 首次打开

应用未做 Apple 签名与公证，Gatekeeper 会拦截，**必须右键点击 → 打开**。
若仍打不开：

```bash
xattr -dr com.apple.quarantine /Applications/QingMo.app
```

## v1.2.0 带来的功能（仍然有效）

- **左侧文件侧边栏** —— 列出所有打开的文档，支持拖拽调宽、`Ctrl+B` 折叠
- **多标签管理** —— 同时打开多个文档，`Ctrl+Tab` 切换、`Ctrl+1~9` 直达、`Ctrl+W` 关闭
- **会话恢复** —— 上次打开的文档下次启动自动恢复（未保存的用暂存内容）
- **版本更新检测** —— 启动时自动检查 GitHub Releases，有新版时顶部提示条提醒
- **应用图标** —— 全平台（Windows 任务栏 / macOS Dock / 应用内标题栏）

## 系统要求

- Windows 10 及以上（x64）
- macOS 11 (Big Sur) 及以上
- 无需安装额外依赖，完全离线运行

## 反馈

问题或建议请到 [Issues](https://github.com/engrecho/qingmo/issues) 提单。
