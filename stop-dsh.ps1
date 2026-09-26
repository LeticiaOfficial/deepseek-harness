$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateFile = Join-Path $root '.launcher\server.json'

if (-not (Test-Path -LiteralPath $stateFile)) {
  Write-Host 'No launcher-managed DeepSeek Harness server was found.'
  exit 0
}

$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
try {
  $process = Get-Process -Id ([int]$state.pid) -ErrorAction Stop
}
catch {
  Remove-Item -LiteralPath $stateFile -Force
  Write-Host 'The tracked server is already stopped.'
  exit 0
}

if ($process.StartTime.ToFileTimeUtc().ToString() -ne [string]$state.startTimeFileTimeUtc) {
  throw 'The saved process ID now belongs to another process; nothing was stopped.'
}

& taskkill.exe /PID $process.Id /T /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "taskkill failed with exit code $LASTEXITCODE"
}

Remove-Item -LiteralPath $stateFile -Force
Write-Host 'DeepSeek Harness has been stopped.'
