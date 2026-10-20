# macOS 打包指南

三种方案，按你的情况选。

---

## 先说结论

| 你的情况 | 用哪个 |
| --- | --- |
| 有 Mac，想要正式发布（.dmg） | **方案 A** |
| 有 Mac，只想要能装的 .app | **方案 B** |
| 只有 Windows | **方案 C**（但有已知限制，见下） |

---

## 方案 A：在 Mac 上打 .dmg（推荐）

`.dmg` 是 macOS 的标准分发格式，有安装向导、能拖到 Applications。
**必须在 Mac 上打**，因为它依赖 macOS 的 `hdiutil` 磁盘镜像工具。

```bash
git clone https://github.com/engrecho/qingmo.git
cd qingmo/dev
npm install
npm run pack:mac
```

产物在 `build-output/mac/`：
- `轻墨-1.2.0.dmg` — 磁盘映像，双击挂载后拖拽安装
- `轻墨-1.2.0-mac-arm64.zip` — Apple Silicon 通用包
- `轻墨-1.2.0-mac-x64.zip` — Intel 通用包

### 加上签名（消除「已损坏」提示）

未签名的应用首次打开必须右键 → 打开。要彻底消除这个提示，
需要 Apple 付费开发者账号（$99/年）：

```bash
# 1. 签名
codesign --deep --force --verbose --options runtime \
  --sign "Developer ID Application: 你的名字 (TEAMID)" \
  "build-output/mac/轻墨-1.2.0-mac-arm64.zip"

# 实际应对解压后的 .app 签名
cd build-output/mac
unzip -q 轻墨-1.2.0-mac-arm64.zip -d signed
codesign --deep --force --options runtime \
  --sign "Developer ID Application: 你的名字 (TEAMID)" \
  signed/轻墨.app
rm 轻墨-1.2.0-mac-arm64.zip
cd signed
zip -qry ../轻墨-1.2.0-mac-arm64.zip 轻墨.app
cd ..

# 2. 公证（notarization）
xcrun notarytool submit 轻墨-1.2.0-mac-arm64.zip \
  --keychain-profile "AC_PROFILE" --wait

# 3. 装订公证票据
xcrun stapler staple 轻墨-1.2.0-mac-arm64.zip
```

公证需要在 Xcode 里配置 `notarytool` 的 keychain profile：

```bash
xcrun notarytool store-credentials "AC_PROFILE" \
  --apple-id "you@example.com" \
  --team-id "TEAMID" \
  --password "app-specific-password"
```

---

## 方案 B：在 Mac 上只打 .app 的 zip

不需要 .dmg，只要一个能解压就能用的包：

```bash
cd qingmo/dev
npm install
npm run mac:fetch     # 下载 Electron mac 运行时（约 200MB，只需一次）
npm run pack:mac-x    # 组装 .app 并压缩
```

产物：`build-output/mac/QingMo-1.2.0-mac-arm64.zip` 与 `-mac-x64.zip`

同样是**未签名**，首次要右键打开。

---

## 方案 C：在 Windows 上交叉打包

```bash
cd qingmo/dev
npm install
npm run mac:fetch
npm run pack:mac-x
```

**能做什么**：产出可用的 `.app` zip（结构与官方包完全一致）。

**不能做什么**：
- 出不了 `.dmg`
- 出不了签名版

---

## 「应用已损坏」的真凶与修复记录

如果你之前下载过早期版本的 mac 包并提示损坏，原因是打包方式有问题。

### 症状

解压 zip 得到 `轻墨.app`，双击或拖到 Applications 后打开报：
**「轻墨」已损坏，无法打开。**

### 根因

Electron 的 mac 框架里有 **14 个符号链接**，比如：

```
Electron Framework.framework/Electron Framework  ->  Versions/Current/Electron Framework
Electron Framework.framework/Versions/Current   ->  A
```

这些链接有两个苛刻要求：

1. **必须存在** —— 缺了 mac 就加载不了框架
2. **目标必须是相对路径** —— 转成绝对路径同样会失效

早期方案是「解压官方 zip → 改内容 → 重新压缩」。在 Windows 上：
- 无法创建符号链接（需管理员权限），一解压就丢了
- 就算用标记文件记录目标，重新压缩时也容易转成绝对路径

结果就是 mac 拿到一个**框架结构损坏**的应用 —— 报「已损坏」。

### 现在的做法

`dev/scripts/mac/build-mac.js` **不解压**，直接改官方 zip 里的条目：

```
读官方 zip → 逐条处理 → 写新 zip
  ├── default_app.asar  →  替换成我们的 app.asar
  ├── electron.icns     →  替换成我们的 icon.icns
  ├── Info.plist        →  改名称/标识/版本/图标声明
  ├── MacOS/Electron    →  改名成 MacOS/QingMo
  ├── Electron.app/     →  改名成 QingMo.app/
  └── 其余条目          →  原样复制（目录、符号链接、权限位全保留）
```

验证结果：

| 指标 | 官方包 | 新包 |
| --- | --- | --- |
| 目录条目 | 145 | 145 |
| 符号链接 | 14 | 14 |
| 文件条目 | 96 | 96 |
| 绝对路径链接 | 0 | 0 |

体积也从异常的 350MB 回到 95.5MB（与官方包一致）。

### 如果你还是打不开

按顺序试：

**① 右键打开**（最常见）

在访达里**右键点击** `轻墨.app` → 选「打开」→ 弹窗里再点「打开」。

**② 清除隔离属性**

```bash
xattr -dr com.apple.quarantine /Applications/轻墨.app
```

**③ 确认芯片架构**

```bash
uname -m          # 输出 arm64 = Apple 芯片，x86_64 = Intel
file /Applications/轻墨.app/Contents/MacOS/轻墨
```

选错架构包在 Rosetta 下通常也能跑，但如果提示架构不兼容，
去 Release 页面下载对应芯片的包。

**④ 检查包完整性**

```bash
unzip -l QingMo-1.2.0-mac-arm64.zip | grep -E "Versions/Current|app.asar"
```

应该能看到 `Versions/Current` 条目和 `app.asar`。

**⑤ 还是不行就在 Mac 上自己打**（方案 A/B），用官方 `electron-builder`，
不会有任何兼容问题。

---

## 常见问题

**Q：为什么 Windows 打不出 .dmg？**
`.dmg` 是磁盘映像，macOS 用 `hdiutil` 生成，Windows 无对应实现。

**Q：交叉打包的包能通过 Gatekeeper 吗？**
不能。签名和公证都需要 Apple 开发者证书，且公证必须在 mac 上跑
（需要访问 Apple 的 notary 服务并绑定 app）。

**Q：`.app` 里的 `轻墨.app` 为什么是 `QingMo.app`？**
`.app` 目录名和内部可执行文件名用 ASCII `QingMo`（macOS 命名惯例，
非 ASCII 名在部分系统调用下有兼容问题），但用户在访达和应用菜单里
看到的都是中文「轻墨」——由 `Info.plist` 的 `CFBundleDisplayName` 决定。

**Q：需要 Intel 版本吗？**
2020 年后的 Mac 都是 Apple 芯片。除非你要给很老的机器用，否则只需要 arm64。

---

## 参考

- [Electron 打包文档](https://www.electronjs.org/docs/latest/tutorial/application-distribution)
- [Apple 代码签名指南](https://developer.apple.com/documentation/security)
- [notarization 流程](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
