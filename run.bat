@echo off
rem WorkBuddy 环境会注入 ELECTRON_RUN_AS_NODE=1，导致 Electron 退化为纯 Node 解释器
if defined ELECTRON_RUN_AS_NODE set ELECTRON_RUN_AS_NODE=
if "%~1"=="pack" goto pack
if "%~1"=="packwin" goto packwin
start "" cmd /c "npx electron ."
exit /b

:pack
call npm run build:renderer
npx electron-builder --win --mac
exit /b

:packwin
call npm run build:renderer
npx electron-builder --win
exit /b