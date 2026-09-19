param(
  [ValidateSet('start','stop','status','logs','invite','revoke-invite','reset-password')][string]$Action = 'status',
  [string]$Image,
  [string]$Value
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$dockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
$dockerPath = if ($dockerCommand) { $dockerCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath $dockerPath)) { $dockerPath = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath $dockerPath)) { throw 'Docker Desktop is not installed.' }
$env:Path = "$(Split-Path $dockerPath);$env:Path"
if ($Image) { $env:V2_IMAGE = $Image }
$composeArgs = @('compose')
$envFile = Join-Path $repo '.env.v2'
if (Test-Path -LiteralPath $envFile) { $composeArgs += @('--env-file', $envFile) }
$composeArgs += @('-f', (Join-Path $PSScriptRoot 'compose.v2.release.yml'))
switch ($Action) {
  'start' { & $dockerPath @composeArgs up -d app }
  'stop' { & $dockerPath @composeArgs stop app }
  'status' { & $dockerPath @composeArgs ps }
  'logs' { & $dockerPath @composeArgs logs --tail 100 app }
  'invite' { & $dockerPath @composeArgs exec -T app node server/v2/admin.ts invite }
  'revoke-invite' { if (-not $Value) { throw 'Supply -Value with the invitation id.' }; & $dockerPath @composeArgs exec -T app node server/v2/admin.ts revoke-invite $Value }
  'reset-password' { if (-not $Value) { throw 'Supply -Value with the username.' }; & $dockerPath @composeArgs exec -T app node server/v2/admin.ts reset-password $Value }
}
if ($LASTEXITCODE -ne 0) { throw "Docker v2 action failed: $Action" }
