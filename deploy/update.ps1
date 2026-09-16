# 快速更新：拉取 CI 构建的最新镜像并重启（约 1-2 分钟）
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  Write-Host '未找到 .env，请先运行 deploy\install.ps1 完成首次安装。'
  exit 1
}

Write-Host '拉取最新镜像（ghcr.io/azhen073/theater-death:latest）...'
docker compose --env-file $envPath -f docker-compose.yml pull
if (-not $?) { exit 1 }
docker compose --env-file $envPath -f docker-compose.yml up -d
if (-not $?) { exit 1 }
Write-Host '更新完成。'
