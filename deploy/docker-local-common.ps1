# Windows PowerShell 5.1-compatible helpers; loading this file has no side effects.
function ConvertTo-NativeArgument {
  param([AllowEmptyString()][string]$Value)
  '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Resolve-LocalDocker {
  param([string]$DockerPath)
  if ($DockerPath) { return (Resolve-Path -LiteralPath $DockerPath -ErrorAction Stop).Path }
  $command = Get-Command docker.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $localRoot = [Environment]::GetFolderPath('LocalApplicationData')
  foreach ($candidate in @((Join-Path $localRoot 'Programs\DockerDesktop\resources\bin\docker.exe'), 'C:\Program Files\Docker\Docker\resources\bin\docker.exe')) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
  }
  throw 'Docker CLI not found. Install Docker Desktop or supply -DockerPath.'
}

function Invoke-DockerCommand {
  param([string]$DockerPath, [string[]]$Arguments, [int]$TimeoutSeconds = 30)
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $DockerPath
  $info.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' '
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $info
  try {
    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      # Kill only this CLI invocation, never the daemon or unrelated processes.
      $process.Kill()
      throw "Docker command timed out after $TimeoutSeconds seconds."
    }
    $out = $stdout.GetAwaiter().GetResult()
    $err = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw "Docker command failed ($($process.ExitCode)): $err" }
    return $out.Trim()
  } finally { $process.Dispose() }
}

function Test-LocalDockerReady {
  param([string]$DockerPath)
  try { $null = Invoke-DockerCommand $DockerPath @('--context', 'desktop-linux', 'info', '--format', '{{.ServerVersion}}') 8; return $true }
  catch { return $false }
}

function Wait-LocalDocker {
  param([string]$DockerPath, [int]$TimeoutSeconds = 90)
  $timer = [Diagnostics.Stopwatch]::StartNew()
  while ($timer.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if (Test-LocalDockerReady $DockerPath) { return }
    Start-Sleep -Seconds 2
  }
  throw 'Docker engine is not ready. Start Docker Desktop and inspect its error. For the known socket startup failure only, use recover-docker-sockets.ps1. No repair was attempted.'
}

function Get-SocketRecoveryTargets {
  param([string]$LocalRoot)
  if (-not [IO.Path]::IsPathRooted($LocalRoot)) { throw 'LocalRoot must be absolute.' }
  (Join-Path $LocalRoot 'Docker\run'), (Join-Path $LocalRoot 'docker-secrets-engine')
}

function Assert-SocketDirectory {
  param([string]$Path, [string[]]$AllowedNames)
  $directory = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (-not $directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Unsafe socket parent directory: $Path" }
  $ancestor = $directory.Parent
  while ($null -ne $ancestor) {
    if ($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Redirected socket ancestor: $($ancestor.FullName)" }
    $ancestor = $ancestor.Parent
  }
  foreach ($item in @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop)) {
    if ($item.PSIsContainer -or $item.Name -notin $AllowedNames -or $item.Length -ne 0) { throw "Unexpected content in socket directory: $($item.Name)" }
  }
}

function Find-SocketStartupFailure {
  param([string]$LogDirectory, [string]$LocalRoot, [datetimeoffset]$Since)
  $paths = @((Join-Path $LocalRoot 'Docker\run\sailor-ingest.sock'), (Join-Path $LocalRoot 'docker-secrets-engine\engine.sock'))
  $pathPatterns = $paths | ForEach-Object { [regex]::Escape($_.Replace('\', '/')) }
  $latest = $null
  $latestRecovery = [datetimeoffset]::MinValue
  foreach ($file in @(Get-ChildItem -LiteralPath $LogDirectory -Filter 'com.docker.backend.exe.log*' -File -ErrorAction Stop | Where-Object { $_.LastWriteTimeUtc -ge $Since.UtcDateTime })) {
    foreach ($line in Get-Content -LiteralPath $file.FullName -ErrorAction Stop) {
      $stampMatch = [regex]::Match($line, '^\[(?<stamp>[^\]]+)\]')
      $stamp = [datetimeoffset]::MinValue
      if (-not [datetimeoffset]::TryParse($stampMatch.Groups['stamp'].Value, [ref]$stamp) -or $stamp -lt $Since) { continue }
      $normalized = $line.Replace('\', '/')
      if ($line -match 'listening on AF_UNIX socket' -and ($pathPatterns | Where-Object { $normalized -match ($_ + '(?=["\s:]|$)') })) {
        if ($stamp -gt $latestRecovery) { $latestRecovery = $stamp }
      }
      if ($line -notmatch 'backend (?:cancelling with error|crashed)' -or $line -notmatch 'The file cannot be accessed by the system' -or $line -notmatch 'starting services: initializing') { continue }
      if (-not ($pathPatterns | Where-Object { $normalized -match ($_ + '(?=[\s:]|$)') })) { continue }
      if ($null -eq $latest -or $stamp -gt $latest.Time) { $latest = [pscustomobject]@{ Time = $stamp; Text = $line } }
    }
  }
  if ($null -ne $latest -and $latest.Time -gt $latestRecovery) { return $latest.Text }
}
