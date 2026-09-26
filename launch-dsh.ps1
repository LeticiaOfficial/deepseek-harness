$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'http://127.0.0.1:3080'
$stateDir = Join-Path $root '.launcher'
$stateFile = Join-Path $stateDir 'server.json'
$launchUrlFile = Join-Path $stateDir 'launch-url.txt'
function Test-HarnessReady {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $connect = $client.ConnectAsync('127.0.0.1', 3080)
    return $connect.Wait(500) -and $client.Connected
  }
  catch {
    return $false
  }
  finally {
    $client.Dispose()
  }
}

function Get-TrackedProcess {
  if (-not (Test-Path -LiteralPath $stateFile)) {
    return $null
  }

  try {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $process = Get-Process -Id ([int]$state.pid) -ErrorAction Stop
    if ($process.StartTime.ToFileTimeUtc().ToString() -ne [string]$state.startTimeFileTimeUtc) {
      return $null
    }
    return $process
  }
  catch {
    return $null
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js was not found. Install Node.js 24 or newer.'
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules\.pnpm'))) {
  throw 'Project dependencies are not installed.'
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'apps\web\dist\index.html'))) {
  throw 'The project has not been built.'
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

$serverProcess = Get-TrackedProcess
if (-not (Test-HarnessReady) -and $null -eq $serverProcess) {
  $startedServer = $true
  Remove-Item -LiteralPath $launchUrlFile -Force -ErrorAction SilentlyContinue
  $serverProcess = Start-Process `
    -FilePath $env:ComSpec `
    -ArgumentList '/d /c "title DeepSeek Harness Server && powershell.exe -NoProfile -ExecutionPolicy Bypass -File run-dsh-server.ps1"' `
    -WorkingDirectory $root `
    -WindowStyle Normal `
    -PassThru

  @{
    pid = $serverProcess.Id
    startTimeFileTimeUtc = $serverProcess.StartTime.ToFileTimeUtc().ToString()
  } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding ASCII
}

for ($attempt = 0; $attempt -lt 3600; $attempt++) {
  if (Test-HarnessReady) {
    if ($startedServer) {
      for ($urlAttempt = 0; $urlAttempt -lt 120; $urlAttempt++) {
        if (Test-Path -LiteralPath $launchUrlFile) {
          $authenticatedUrl = (Get-Content -LiteralPath $launchUrlFile -Raw).Trim()
          if ($authenticatedUrl -match '^http://127\.0\.0\.1:3080/\?token=[A-Za-z0-9_-]+$') {
            Start-Process $authenticatedUrl
            Remove-Item -LiteralPath $launchUrlFile -Force -ErrorAction SilentlyContinue
            break
          }
        }
        Start-Sleep -Milliseconds 100
      }
    }
    else {
      Start-Process $url
    }
    Write-Host "DeepSeek Harness is running at $url"
    exit 0
  }

  if ($null -ne $serverProcess -and $serverProcess.HasExited) {
    break
  }
  Start-Sleep -Milliseconds 250
}

throw 'The server did not become ready. Check the DeepSeek Harness Server window.'
