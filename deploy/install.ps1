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
    'VOICE_ENABLED=false'
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
