#!/usr/bin/env bash
# 日常启动：拉起服务并输出访问入口
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="$(cd .. && pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "未找到 .env，请先运行 deploy/install.sh 完成首次安装。"
  exit 1
fi

docker compose --env-file "$ENV_FILE" -f docker-compose.yml up -d

base="$(grep -E '^PUBLIC_BASE_URL=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
if [ -z "$base" ]; then
  base="http://localhost:3000"
fi
echo ""
echo "服务已启动，浏览器打开：$base"
echo "停止服务：deploy/stop.sh"
