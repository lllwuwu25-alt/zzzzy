#!/bin/zsh
cd "$(dirname "$0")/../.." || exit 1
if ! command -v node >/dev/null; then
  echo "请先安装 Node.js 20 或更新版本，再打开本工具。"
  read -r "?按回车退出"
  exit 1
fi
node tools/license-admin/cli.mjs
read -r "?授权工具已关闭，按回车退出"
