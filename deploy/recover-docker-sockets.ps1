# Explicit recovery only. Normal startup never calls this script.
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param([string]$DockerPath)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'docker-local-common.ps1')
$docker = Resolve-LocalDocker $DockerPath
if (Test-LocalDockerReady $docker) { Write-Host 'Docker engine is healthy; no recovery needed.'; return }
$localRoot = [Environment]::GetFolderPath('LocalApplicationData')
$logDirectory = Join-Path $localRoot 'Docker\log\host'
$failure = Find-SocketStartupFailure $logDirectory $localRoot ([datetimeoffset]::Now.AddMinutes(-15))
if (-not $failure) { throw 'No matching socket startup failure in the last 15 minutes. Refusing recovery; inspect Docker Desktop logs.' }
$targets = @(Get-SocketRecoveryTargets $localRoot)
$allowLists = @(@('dockerEthernetVfkit', 'dockerInference', 'sailor-ingest.sock', 'userAnalyticsOtlpHttp.sock'), @('engine.sock'))
for ($i = 0; $i -lt $targets.Count; $i++) {
  $resolved = (Resolve-Path -LiteralPath $targets[$i] -ErrorAction Stop).Path
  if ($resolved -ne [IO.Path]::GetFullPath($targets[$i])) { throw 'Unexpected socket path resolution.' }
  Assert-SocketDirectory $resolved $allowLists[$i]
}
Write-Host "Confirmed recent startup failure: $failure"
if (-not $PSCmdlet.ShouldProcess(($targets -join ', '), 'Stop failed Docker Desktop, preserve socket directories, and restart Desktop')) { return }
# A bounded graceful stop: if it cannot stop the failed processes, refuse to rename.
# No automatic force kill or WSL shutdown; inspect remaining processes separately.
try { $null = Invoke-DockerCommand $docker @('desktop', 'stop', '--timeout', '30') 40 }
catch { Write-Warning 'Docker Desktop stop did not complete; checking whether any Desktop processes remain.' }
if (Get-Process -Name 'com.docker.backend', 'Docker Desktop' -ErrorAction SilentlyContinue) {
  throw 'Docker Desktop processes remain. Quit the Docker Desktop error dialog and rerun recovery. No directories were changed.'
}
if (Test-LocalDockerReady $docker) { throw 'Engine became available; refusing socket isolation.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
# Validate both directories again before the first rename.
for ($i = 0; $i -lt $targets.Count; $i++) { Assert-SocketDirectory $targets[$i] $allowLists[$i] }
foreach ($target in $targets) {
  $newName = (Split-Path $target -Leaf) + '.recovery-' + $stamp
  Rename-Item -LiteralPath $target -NewName $newName -ErrorAction Stop
  New-Item -ItemType Directory -Path $target -ErrorAction Stop | Out-Null
  Write-Host "Preserved: $(Join-Path (Split-Path $target -Parent) $newName)"
}
Invoke-DockerCommand $docker @('desktop', 'start', '--timeout', '90') 100
Wait-LocalDocker $docker
& (Join-Path $PSScriptRoot 'frontend-local.ps1') -Action start -DockerPath $docker
