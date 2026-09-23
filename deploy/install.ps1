# 首次安装：检查 Docker -> 生成 .env -> 构建镜像 -> 启动服务
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host '未找到 docker 命令，请先安装并启动 Docker Desktop 后重试。'
  Write-Host '下载地址：https://www.docker.com/products/docker-desktop/'
  exit 1
}

$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (Test-Path -LiteralPath $envPath) {
  Write-Host '检测到既有 .env，跳过生成（如需重建请先删除 .env）。'
} else {
  $secret = -join (1..64 | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  $lines = @(
    '# 由 deploy/install.ps1 生成；请勿提交到版本库',
    'APP_PORT=3000',
    'SESSION_SECRET=' + $secret,
    'SESSION_COOKIE_SECURE=false',
    'PUBLIC_BASE_URL=http://localhost:3000',
    '# 可选：管理后台口令（16–256 位），留空即关闭管理后台',
    'ADMIN_PASSWORD=',
    '# 语音（声网）：填入声网控制台项目的 App ID / App Certificate 并把 VOICE_ENABLED 改为 true',
    'VOICE_ENABLED=false',
    'AGORA_APP_ID=',
    'AGORA_APP_CERTIFICATE=',
    '# 频道管理 REST（踢人 / 终局关房 / 频道对账）：控制台「设置 → RESTful API → 添加密钥」，客户密钥只能下载一次',
    'AGORA_CUSTOMER_KEY=',
    'AGORA_CUSTOMER_SECRET=',
    '# 可选：频道管理 REST 基地址，中国区留空即用默认 https://api.sd-rtn.com，全球区项目填 https://api.agora.io',
    'AGORA_REST_BASE_URL='
  )
  [System.IO.File]::WriteAllLines($envPath, $lines, (New-Object System.Text.UTF8Encoding $false))
  Write-Host '已生成 .env（含随机 SESSION_SECRET）。'
}

Write-Host '尝试拉取预构建镜像（由 CI 构建）...'
docker compose --env-file $envPath -f docker-compose.yml pull
if ($?) {
  Write-Host '已获取预构建镜像。'
} else {
  Write-Host '预构建镜像不可用，改为本地构建（包含全部测试，首次约需数分钟）...'
  docker compose --env-file $envPath -f docker-compose.yml build
  if (-not $?) { exit 1 }
}

docker compose --env-file $envPath -f docker-compose.yml up -d
if (-not $?) { exit 1 }

Write-Host ''
Write-Host '安装完成。浏览器打开 http://localhost:3000 创建房间，把房间码发给同伴。'
Write-Host '停止服务：deploy\stop.ps1    日常启动：deploy\start.ps1'
