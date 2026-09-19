[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$script:Failures = New-Object System.Collections.Generic.List[string]

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Equal {
    param($Actual, $Expected, [string]$Message)
    if ($Actual -ne $Expected) {
        throw ("{0}. Expected '{1}', got '{2}'." -f $Message, $Expected, $Actual)
    }
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    $thrown = $false
    try {
        & $Action
    } catch {
        $thrown = $true
    }
    Assert-True $thrown $Message
}

function Invoke-Case {
    param([string]$Name, [scriptblock]$Action)
    try {
        & $Action
        Write-Output ("PASS {0}" -f $Name)
    } catch {
        $script:Failures.Add(("FAIL {0}: {1}" -f $Name, $_.Exception.Message))
    }
}

$commonPath = Join-Path $PSScriptRoot '..\deploy\docker-local-common.ps1'
if (-not (Test-Path -LiteralPath $commonPath -PathType Leaf)) {
    throw ("Required implementation file was not found: {0}" -f $commonPath)
}
. $commonPath

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ("theater-deploy-tests-{0}" -f ([guid]::NewGuid().ToString('N')))
New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null

try {
    Invoke-Case 'ConvertTo-NativeArgument quotes empty and whitespace values' {
        Assert-Equal (ConvertTo-NativeArgument '') '""' 'Empty argument must be quoted'
        Assert-Equal (ConvertTo-NativeArgument 'plain') '"plain"' 'Arguments must use Win32-safe quoting'
        $quoted = ConvertTo-NativeArgument 'two words'
        Assert-True ($quoted -eq '"two words"') 'Whitespace argument must be quoted'
        $embedded = ConvertTo-NativeArgument 'a"b'
        Assert-True ($embedded -match '\\"') 'Embedded quotes must be escaped'
        Assert-True ((ConvertTo-NativeArgument 'C:\temp\') -match '\\"$') 'Trailing backslash must be escaped before the closing quote'
    }

    Invoke-Case 'Invoke-DockerCommand returns stdout and accepts argument boundaries' {
        $ps = (Get-Command powershell.exe -CommandType Application).Source
        $mock = Join-Path $fixtureRoot 'mock-command.ps1'
        Set-Content -LiteralPath $mock -Value 'param([string]$Value); Write-Output $Value'
        $values = @('two words', 'a"b', 'C:\temp\')
        foreach ($value in $values) {
            $output = Invoke-DockerCommand $ps @('-NoProfile', '-NonInteractive', '-File', $mock, '-Value', $value) 10
            Assert-Equal ([string]$output).Trim() $value ("Mock command output mismatch for '{0}'" -f $value)
        }
    }

    Invoke-Case 'Invoke-DockerCommand throws for nonzero process' {
        $ps = (Get-Command powershell.exe -CommandType Application).Source
        Assert-Throws { Invoke-DockerCommand $ps @('-NoProfile', '-NonInteractive', '-Command', 'exit 17') 10 } 'Nonzero process must throw'
    }

    Invoke-Case 'Invoke-DockerCommand throws on timeout' {
        $ps = (Get-Command powershell.exe -CommandType Application).Source
        Assert-Throws { Invoke-DockerCommand $ps @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 4') 1 } 'Timed out process must throw'
    }

    Invoke-Case 'Get-SocketRecoveryTargets returns exact absolute paths' {
        $localRoot = Join-Path $fixtureRoot 'local-root'
        New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
        $targets = @(Get-SocketRecoveryTargets $localRoot)
        Assert-Equal $targets.Count 2 'Recovery target count mismatch'
        $expected = @(
            [IO.Path]::GetFullPath((Join-Path $localRoot 'Docker\run')),
            [IO.Path]::GetFullPath((Join-Path $localRoot 'docker-secrets-engine'))
        )
        Assert-Equal ([IO.Path]::GetFullPath($targets[0])) $expected[0] 'Docker run path mismatch'
        Assert-Equal ([IO.Path]::GetFullPath($targets[1])) $expected[1] 'Secrets engine path mismatch'
    }

    Invoke-Case 'Assert-SocketDirectory accepts only allowed socket entries' {
        $directory = Join-Path $fixtureRoot 'socket-good'
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        New-Item -ItemType File -Path (Join-Path $directory 'sailor-ingest.sock') -Force | Out-Null
        New-Item -ItemType File -Path (Join-Path $directory 'engine.sock') -Force | Out-Null
        Assert-SocketDirectory $directory @('sailor-ingest.sock', 'engine.sock')
    }

    Invoke-Case 'Assert-SocketDirectory rejects nested and unknown data' {
        $nested = Join-Path $fixtureRoot 'socket-nested'
        New-Item -ItemType Directory -Path (Join-Path $nested 'nested') -Force | Out-Null
        Assert-Throws { Assert-SocketDirectory $nested @('sailor-ingest.sock', 'engine.sock') } 'Nested directory must be rejected'

        $unknown = Join-Path $fixtureRoot 'socket-unknown'
        New-Item -ItemType Directory -Path $unknown -Force | Out-Null
        New-Item -ItemType File -Path (Join-Path $unknown 'unexpected.txt') -Force | Out-Null
        Assert-Throws { Assert-SocketDirectory $unknown @('sailor-ingest.sock', 'engine.sock') } 'Unknown child must be rejected'

        $nonzero = Join-Path $fixtureRoot 'socket-nonzero'
        New-Item -ItemType Directory -Path $nonzero -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $nonzero 'engine.sock') -Value 'not a socket' -NoNewline
        Assert-Throws { Assert-SocketDirectory $nonzero @('engine.sock') } 'Nonzero file must be rejected'
    }

    Invoke-Case 'Assert-SocketDirectory rejects a reparse point parent when available' {
        $real = Join-Path $fixtureRoot 'socket-real'
        $link = Join-Path $fixtureRoot 'socket-link'
        New-Item -ItemType Directory -Path $real -Force | Out-Null
        try {
            New-Item -ItemType Junction -Path $link -Target $real -Force | Out-Null
        } catch {
            Write-Output 'SKIP reparse-point fixture unavailable on this host'
            return
        }
        Assert-Throws { Assert-SocketDirectory $link @('engine.sock') } 'Reparse-point parent must be rejected'
    }

    Invoke-Case 'Find-SocketStartupFailure matches recent exact fatal records only' {
        $logs = Join-Path $fixtureRoot 'logs'
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $since = [DateTimeOffset]::Now.AddMinutes(-5)
        $recent = $since.AddMinutes(2).ToString('o')
        $old = $since.AddMinutes(-2).ToString('o')
        $runPath = ([IO.Path]::GetFullPath((Join-Path $fixtureRoot 'Docker\run'))).Replace('\', '/')
        $recentLine = "[{0}] backend cancelling with error: starting services: initializing {1}/sailor-ingest.sock: The file cannot be accessed by the system" -f $recent, $runPath
        $latest = $since.AddMinutes(3).ToString('o')
        $engineLine = "[{0}] backend crashed: starting services: initializing {1}/engine.sock: The file cannot be accessed by the system" -f $latest, ([IO.Path]::GetFullPath((Join-Path $fixtureRoot 'docker-secrets-engine'))).Replace('\', '/')
        $oldLine = "[{0}] backend cancelling with error: starting services: initializing {1}/engine.sock: The file cannot be accessed by the system" -f $old, $runPath
        $unrelatedLine = "[{0}] backend cancelling with error: starting services: initializing {1}/other.sock: The file cannot be accessed by the system" -f $recent, $runPath
        Set-Content -LiteralPath (Join-Path $logs 'com.docker.backend.exe.log.old') -Value $oldLine
        Set-Content -LiteralPath (Join-Path $logs 'com.docker.backend.exe.log.unrelated') -Value $unrelatedLine
        Set-Content -LiteralPath (Join-Path $logs 'com.docker.backend.exe.log') -Value $recentLine
        Set-Content -LiteralPath (Join-Path $logs 'com.docker.backend.exe.log.1') -Value $engineLine
        $match = Find-SocketStartupFailure $logs $fixtureRoot $since
        Assert-True ($null -ne $match) 'Recent exact socket failure should match'
        Assert-True ([string]$match -match 'engine\.sock') 'Most recent matched record should identify engine.sock'
    }

    Invoke-Case 'Find-SocketStartupFailure returns null for stale, unrelated, and crashless records' {
        $logs = Join-Path $fixtureRoot 'logs-negative'
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $since = [DateTimeOffset]::Now.AddMinutes(-5)
        $old = $since.AddMinutes(-1).ToString('o')
        $runPath = ([IO.Path]::GetFullPath((Join-Path $fixtureRoot 'Docker\run'))).Replace('\', '/')
        Set-Content -LiteralPath (Join-Path $logs 'com.docker.backend.exe.log') -Value ("[{0}] backend cancelling with error: starting services: initializing {1}/sailor-ingest.sock: The file cannot be accessed by the system" -f $old, $runPath)
        $match = Find-SocketStartupFailure $logs $fixtureRoot $since
        Assert-True ($null -eq $match) 'No eligible startup failure should return null'

        $cases = @(
            @{ Name = 'recent wrong socket suffix'; Line = "[{0}] backend cancelling with error: starting services: initializing {1}/sailor-ingest.sock.other: The file cannot be accessed by the system" -f ([DateTimeOffset]::Now.ToString('o')), $runPath },
            @{ Name = 'recent wrong socket path'; Line = "[{0}] backend cancelling with error: starting services: initializing {1}/other.sock: The file cannot be accessed by the system" -f ([DateTimeOffset]::Now.ToString('o')), $runPath },
            @{ Name = 'recent nonfatal backend record'; Line = "[{0}] backend completed: starting services: initializing {1}/sailor-ingest.sock: The file cannot be accessed by the system" -f ([DateTimeOffset]::Now.ToString('o')), $runPath },
            @{ Name = 'recent wrong error text'; Line = "[{0}] backend cancelling with error: starting services: initializing {1}/sailor-ingest.sock: Access is denied" -f ([DateTimeOffset]::Now.ToString('o')), $runPath }
        )
        foreach ($case in $cases) {
            $caseDirectory = Join-Path $logs (($case.Name -replace '[^a-zA-Z0-9]+', '-'))
            New-Item -ItemType Directory -Path $caseDirectory -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $caseDirectory 'com.docker.backend.exe.log') -Value $case.Line
            $caseMatch = Find-SocketStartupFailure $caseDirectory $fixtureRoot $since
            Assert-True ($null -eq $caseMatch) ("{0} must not match" -f $case.Name)
        }

        $listenerPath = $runPath + '/sailor-ingest.sock'
        $listenerCases = @(
            @{
                Name = 'later exact listener suppresses old failure'
                Lines = @(
                    ("[{0}] backend cancelling with error: starting services: initializing {1}: The file cannot be accessed by the system" -f $since.AddMinutes(1).ToString('o'), $listenerPath),
                    ('[{0}] listening on AF_UNIX socket: path="{1}" len=58' -f $since.AddMinutes(2).ToString('o'), $listenerPath)
                )
                ExpectedNull = $true
            },
            @{
                Name = 'later unrelated listener does not suppress failure'
                Lines = @(
                    ("[{0}] backend cancelling with error: starting services: initializing {1}: The file cannot be accessed by the system" -f $since.AddMinutes(1).ToString('o'), $listenerPath),
                    ("[{0}] listening on AF_UNIX socket {1}/other.sock" -f $since.AddMinutes(2).ToString('o'), $runPath)
                )
                ExpectedNull = $false
            },
            @{
                Name = 'still later failure supersedes exact listener'
                Lines = @(
                    ("[{0}] backend cancelling with error: starting services: initializing {1}: The file cannot be accessed by the system" -f $since.AddMinutes(1).ToString('o'), $listenerPath),
                    ("[{0}] listening on AF_UNIX socket {1}" -f $since.AddMinutes(2).ToString('o'), $listenerPath),
                    ("[{0}] backend crashed: starting services: initializing {1}: The file cannot be accessed by the system" -f $since.AddMinutes(3).ToString('o'), $listenerPath)
                )
                ExpectedNull = $false
            }
        )
        foreach ($case in $listenerCases) {
            $caseDirectory = Join-Path $logs (($case.Name -replace '[^a-zA-Z0-9]+', '-'))
            New-Item -ItemType Directory -Path $caseDirectory -Force | Out-Null
            Set-Content -LiteralPath (Join-Path $caseDirectory 'com.docker.backend.exe.log') -Value $case.Lines
            $caseMatch = Find-SocketStartupFailure $caseDirectory $fixtureRoot $since
            if ($case.ExpectedNull) {
                Assert-True ($null -eq $caseMatch) ("{0} must return null" -f $case.Name)
            } else {
                Assert-True ($null -ne $caseMatch) ("{0} must retain the failure" -f $case.Name)
            }
        }
    }
} finally {
    if (Test-Path -LiteralPath $fixtureRoot) {
        $fixtureFull = [IO.Path]::GetFullPath($fixtureRoot).TrimEnd('\')
        $tempFull = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        $fixtureInfo = Get-Item -LiteralPath $fixtureFull -Force
        $safeName = $fixtureInfo.Name -match '^theater-deploy-tests-[0-9a-f]{32}$'
        $safeParent = ([IO.Directory]::GetParent($fixtureFull)).FullName.TrimEnd('\') -eq $tempFull
        if ($safeName -and $safeParent) {
            Remove-Item -LiteralPath $fixtureFull -Recurse -Force -ErrorAction SilentlyContinue
        } else {
            Write-Warning ("Refusing cleanup outside validated fixture scope: {0}" -f $fixtureFull)
        }
    }
}

if ($script:Failures.Count -gt 0) {
    $script:Failures | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output 'All deploy frontend-local PowerShell tests passed.'
exit 0
