param(
  [ValidateSet('start', 'stop', 'status')][string]$Action = 'start',
  [ValidateSet('off', 'on')][string]$Voice = 'off',
  [string]$DockerPath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'docker-local-common.ps1')
$docker = Resolve-LocalDocker $DockerPath
$repo = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $repo '.env.frontend-local'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw "Missing $envFile. Copy .env.frontend-local.example only if the local file does not already exist, then configure ADMIN_PASSWORD."
}
$composeArgs = @('--context', 'desktop-linux', 'compose', '--env-file', $envFile, '-f', (Join-Path $PSScriptRoot 'compose.frontend-local.yml'))
if ($Voice -eq 'on') { $composeArgs += @('-f', (Join-Path $PSScriptRoot 'compose.frontend-local-voice.yml')) }
$composeArgs += @('--profile', 'voice')
Write-Host 'Waiting for the local Docker Desktop Linux engine...'
Wait-LocalDocker $docker
switch ($Action) {
  'start' {
    Write-Host 'Starting the existing local image and waiting for container health...'
    $services = @('app')
    Invoke-DockerCommand $docker ($composeArgs + @('up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '90') + $services) 110
    foreach ($path in @('/healthz', '/', '/admin')) {
      $uri = 'http://localhost:5174' + $path
      $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -ne 200) { throw "HTTP health check failed: $uri" }
      if ($path -eq '/healthz') {
        $health = $response.Content | ConvertFrom-Json
        if ($health.status -ne 'ok' -or $health.apiVersion -ne 2) { throw 'Unexpected API health response.' }
      }
      Write-Host "OK $uri"
    }
    Write-Host "Ready: http://localhost:5174 (admin: /admin, voice: $Voice)"
  }
  'stop' { Invoke-DockerCommand $docker ($composeArgs + @('stop', 'app')) 40 }
  'status' { Invoke-DockerCommand $docker ($composeArgs + @('ps', '--all')) 15 }
}
