#!/usr/bin/env bash
# 快速更新：拉取 CI 构建的最新镜像并重启（约 1-2 分钟）
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="$(cd .. && pwd)/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "未找到 .env，请先运行 deploy/install.sh 完成首次安装。"
  exit 1
fi

echo "拉取最新镜像（ghcr.io/azhen073/theater-death:latest）..."
docker compose --env-file "$ENV_FILE" -f docker-compose.yml pull
docker compose --env-file "$ENV_FILE" -f docker-compose.yml up -d
echo "更新完成。"
