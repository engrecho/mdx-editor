#!/bin/bash
# 轻墨 QingMo — macOS 一键打包
#
# 用法（在仓库根目录执行）：
#   ./dev/pack-mac.sh              打当前架构（arm64 或 x64 都行）
#   ./dev/pack-mac.sh --both       同时打 arm64 和 x64
#   ./dev/pack-mac.sh --dmg        只打 dmg 安装包
#
# 产物位置：build-out/mac/

set -e

cd "$(dirname "$0"))"
echo "==> 工作目录：$(pwd)"

# 1. 检查 Node.js，至少 v18
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "✗ 需要 Node.js 18 或更高，当前是 $(node -v)"
  echo "  去 https://nodejs.org 下载 LTS 版本"
  exit 1
fi
echo "==> Node.js $(node -v)"

# 2. 装依赖
if [ ! -d node_modules/electron ]; then
  echo "==> 安装依赖（首次约 1-3 分钟）..."
  npm install
else
  echo "==> 依赖已就绪"
fi

# 3. 检查图标（.gitignore 已把 icon.icns 保留入库，这里兜底检查）
if [ ! -f build/icons/icon.icns ]; then
  echo "✗ 缺少 build/icons/icon.icns"
  echo "  这个文件随仓库分发。若确实丢失，从 Release 页下载任意 mac 包"
  echo "  解压后取 QingMo.app/Contents/Resources/icon.icns 放回该路径。"
  exit 1
fi
echo "==> 图标就绪"

# 4. 打包
case "${1:-}" in
  --both)
    echo "==> 打双架构 dmg + zip（产物最大，约 400MB）..."
    npm run pack:mac
    ;;
  --dmg)
    echo "==> 只打 dmg..."
    npm run pack:mac:dmg
    ;;
  *)
    echo "==> 打当前架构 dmg + zip..."
    npm run pack:mac
    ;;
esac

echo
echo "==> 打包完成，产物在 build-out/mac/"
ls -lh build-out/mac/

cat <<'EOF'

--------------------------------------------------------------------
接下来怎么装：

  1. 双击 .dmg 文件挂载
  2. 把「轻墨」拖到 Applications 文件夹
  3. 打开「应用程序」→「轻墨」

首次打开如果提示「无法验证开发者」：
  右键点击 app → 选「打开」→ 弹窗里再点「打开」，只需做一次。

或者在终端执行：
  xattr -cr /Applications/轻墨.app

本包已做 ad-hoc 签名（identity: null），绝大多数情况可直接双击打开。
--------------------------------------------------------------------
EOF