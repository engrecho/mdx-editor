# 轻墨 QingMo v1.2.0

简洁轻量的跨平台 Markdown 编辑器 —— 左边写，右边即时看到成品。

## 本次更新

### 新增

- **左侧文件侧边栏** —— 列出所有打开的文档，支持拖拽调宽、`Ctrl+B` 折叠
- **多标签管理** —— 同时打开多个文档，`Ctrl+Tab` 切换、`Ctrl+1~9` 直达、`Ctrl+W` 关闭
- **会话恢复** —— 上次打开的文档下次启动自动恢复（未保存的用暂存内容）
- **版本更新检测** —— 启动时自动检查 GitHub Releases，有新版时顶部提示条提醒
- **应用图标** —— 全平台（Windows 任务栏 / macOS Dock / 应用内标题栏）

### 改进

- 标题栏品牌区改为「图标 + 名称」，图标在 16px 下依然清晰可辨
- 关闭带修改的文档时可选保存或放弃（不会误丢内容）
- 侧边栏脏标记刷新做节流优化，输入时不再频繁重排 DOM

## 下载

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `轻墨 Setup 1.2.0.exe` | 安装版（推荐） |
| Windows | `轻墨 1.2.0.exe` | 单文件版，首次启动需解压，稍慢 |
| Windows | `portable/轻墨.exe` | 免安装目录版，双击即开 |
| macOS (Apple 芯片) | `QingMo-1.2.0-mac-arm64.zip` | M1/M2/M3/M4 |
| macOS (Intel) | `QingMo-1.2.0-mac-x64.zip` | 较老的 Intel 机型 |

### macOS 首次打开

应用未做 Apple 签名与公证，Gatekeeper 会拦截，**必须右键点击 → 打开**。
若仍打不开：

```bash
xattr -dr com.apple.quarantine /Applications/QingMo.app
```

## 系统要求

- Windows 10 及以上（x64）
- macOS 11 (Big Sur) 及以上
- 无需安装额外依赖，完全离线运行

## 反馈

问题或建议请到 [Issues](https://github.com/engrecho/qingmo/issues) 提单。
