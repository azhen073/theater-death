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
  livekit_key="LK$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  livekit_secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  {
    echo '# 由 deploy/install.sh 生成；请勿提交到版本库'
    echo 'APP_PORT=3000'
    echo "SESSION_SECRET=$secret"
    echo 'SESSION_COOKIE_SECURE=false'
    echo 'PUBLIC_BASE_URL=http://localhost:3000'
    echo '# 启用自托管语音：把 VOICE_ENABLED 改为 true，并取消 COMPOSE_PROFILES 注释'
    echo 'VOICE_ENABLED=false'
    echo "LIVEKIT_API_KEY=$livekit_key"
    echo "LIVEKIT_API_SECRET=$livekit_secret"
    echo 'LIVEKIT_NODE_IP=127.0.0.1'
    echo '# COMPOSE_PROFILES=voice'
  } > "$ENV_FILE"
  echo "已生成 .env（含随机 SESSION_SECRET 与 LiveKit 密钥）。"
fi

echo "尝试拉取预构建镜像（由 CI 构建）..."
if docker compose --env-file "$ENV_FILE" -f docker-compose.yml pull; then
  echo "已获取预构建镜像。"
else
  echo "预构建镜像不可用，改为本地构建（包含全部测试，首次约需数分钟）..."
  docker compose --env-file "$ENV_FILE" -f docker-compose.yml build
fi
docker compose --env-file "$ENV_FILE" -f docker-compose.yml up -d

echo ""
echo "安装完成。浏览器打开 http://localhost:3000 创建房间，把房间码发给同伴。"
echo "停止服务：deploy/stop.sh    日常启动：deploy/start.sh"
