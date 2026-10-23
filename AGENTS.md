1. release是发布文件夹，将 MAC 和WIN的分开
2. 每次开发完删除临时无用的文件
3. 每次需要更新文档。
4. 修改代码时必须区分 Windows / macOS 双端兼容性：路径分隔符（\ vs /）、文件关联/默认程序注册、托盘与菜单、代码签名（APPX vs DMG）、shell 调用、快捷键（Ctrl vs Cmd）等都可能存在平台差异，不要写死单平台假设；跨平台逻辑按 process.platform 做条件分支，并尽量在两端都验证。
4. 

