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
    echo '# 可选：管理后台口令（16–256 位），留空即关闭管理后台'
    echo 'ADMIN_PASSWORD='
    echo '# 语音（声网）：填入声网控制台项目的 App ID / App Certificate 并把 VOICE_ENABLED 改为 true'
    echo 'VOICE_ENABLED=false'
    echo 'AGORA_APP_ID='
    echo 'AGORA_APP_CERTIFICATE='
    echo '# 频道管理 REST（踢人 / 终局关房 / 频道对账）：控制台「设置 → RESTful API → 添加密钥」，客户密钥只能下载一次'
    echo 'AGORA_CUSTOMER_KEY='
    echo 'AGORA_CUSTOMER_SECRET='
    echo '# 可选：频道管理 REST 基地址，中国区留空即用默认 https://api.sd-rtn.com，全球区项目填 https://api.agora.io'
    echo 'AGORA_REST_BASE_URL='
  } > "$ENV_FILE"
  echo "已生成 .env（含随机 SESSION_SECRET）。"
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
