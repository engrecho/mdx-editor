@echo off
chcp 65001 >nul
rem ============================================
rem  轻墨 QingMo - Windows 启动脚本
rem
rem  用法：
rem    run.bat          启动应用
rem    run.bat pack     打包 Windows 版
rem    run.bat packmac  交叉打包 macOS 版
rem ============================================

rem WorkBuddy / VSCode 内置终端会注入 ELECTRON_RUN_AS_NODE=1，
rem 导致 Electron 退化为纯 Node 解释器，必须清掉
if defined ELECTRON_RUN_AS_NODE set ELECTRON_RUN_AS_NODE=

cd /d "%~dp0"

if "%~1"=="pack" (
  call npm run build:renderer
  npx electron-builder --win
  echo.
  echo 打包完成，产物在 build-output\
  pause
  exit /b
)

if "%~1"=="packmac" (
  call npm run mac:fetch
  call npm run build:renderer
  node scripts\mac\build-mac.js
  pause
  exit /b
)

if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install
)

echo 正在启动轻墨...
npx electron .
