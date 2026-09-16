#!/usr/bin/env bash
# 首次安装：检查 Docker -> 生成 .env -> 构建镜像 -> 启动服务
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker 命令，请先安装 Docker Engine / Docker Desktop 后重试。"
  exit 1
fi

ENV_FILE="$(cd .. && pwd)/.env"
if [ -f "$ENV_FILE" ]; then
  echo "检测到既有 .env，跳过生成（如需重建请先删除 .env）。"
else
  secret="$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  {
    echo '# 由 deploy/install.sh 生成；请勿提交到版本库'
    echo 'APP_PORT=3000'
    echo "SESSION_SECRET=$secret"
    echo 'SESSION_COOKIE_SECURE=false'
    echo 'PUBLIC_BASE_URL=http://localhost:3000'
    echo 'VOICE_ENABLED=false'
  } > "$ENV_FILE"
  echo "已生成 .env（含随机 SESSION_SECRET）。"
fi

echo "构建镜像（包含全部测试，首次约需数分钟）..."
docker compose --env-file "$ENV_FILE" -f docker-compose.yml build
docker compose --env-file "$ENV_FILE" -f docker-compose.yml up -d

echo ""
echo "安装完成。浏览器打开 http://localhost:3000 创建房间，把房间码发给同伴。"
echo "停止服务：deploy/stop.sh    日常启动：deploy/start.sh"
