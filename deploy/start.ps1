# 日常启动：拉起服务并输出访问入口
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$envPath = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
  Write-Host '未找到 .env，请先运行 deploy\install.ps1 完成首次安装。'
  exit 1
}

docker compose --env-file $envPath -f docker-compose.yml up -d
if (-not $?) { exit 1 }

$base = (Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^PUBLIC_BASE_URL=' } | Select-Object -First 1) -replace '^PUBLIC_BASE_URL=', ''
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'http://localhost:3000' }
Write-Host ''
Write-Host "服务已启动，浏览器打开：$base"
Write-Host '停止服务：deploy\stop.ps1'
