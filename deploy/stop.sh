#!/usr/bin/env bash
# 停止服务（数据保留在 data 目录）
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="$(cd .. && pwd)/.env"
docker compose --env-file "$ENV_FILE" -f docker-compose.yml down
echo "服务已停止（数据保留在 data 目录）。"
