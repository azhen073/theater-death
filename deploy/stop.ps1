# 停止服务（数据保留在 data 目录）
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
docker compose --env-file $envPath -f docker-compose.yml down
Write-Host '服务已停止（数据保留在 data 目录）。'
