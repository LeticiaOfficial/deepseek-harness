$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$stateDir = Join-Path $root '.launcher'
$toolDir = Join-Path $stateDir 'bin'
$buildStateFile = Join-Path $stateDir 'build-state.txt'
$launchUrlFile = Join-Path $stateDir 'launch-url.txt'
$pnpmVersion = '11.7.0'
Set-Location -LiteralPath $root
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

# Corepack can run pnpm even when its optional pnpm shim was not installed into
# the Node.js directory. Package scripts in this repository invoke `pnpm`
# directly, so expose a launcher-local shim to those child processes.
New-Item -ItemType Directory -Path $toolDir -Force | Out-Null
$pnpmShim = Join-Path $toolDir 'pnpm.cmd'
Set-Content -LiteralPath $pnpmShim -Encoding ASCII -Value @(
  '@echo off'
  "corepack pnpm@$pnpmVersion %*"
)
$env:Path = "$toolDir;$env:Path"

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Description,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  Write-Host "`n== $Description ==" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
  }
}

try {
  $commit = (& git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to read the current Git commit.'
  }
  $sourceFiles = @(& git -c core.quotepath=false ls-files --cached --others --exclude-standard -- `
    apps packages scripts vendor native website `
    package.json pnpm-lock.yaml pnpm-workspace.yaml `
    tsconfig.base.json tsconfig.client.json tsconfig.host.json tsdown.config.ts) |
    Where-Object { Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf }
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to enumerate the project source files.'
  }
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $sourceState = foreach ($sourceFile in $sourceFiles) {
      $absoluteSourceFile = Join-Path $root $sourceFile
      $sourceStream = [System.IO.File]::OpenRead($absoluteSourceFile)
      try {
        $fileHash = [System.BitConverter]::ToString($sha256.ComputeHash($sourceStream)).Replace('-', '')
      }
      finally {
        $sourceStream.Dispose()
      }
      "$sourceFile`t$fileHash"
    }
    $sourceBytes = [System.Text.Encoding]::UTF8.GetBytes(($sourceState -join "`n"))
    $sourceHash = [System.BitConverter]::ToString($sha256.ComputeHash($sourceBytes)).Replace('-', '')
  }
  finally {
    $sha256.Dispose()
  }
  $expectedBuildState = "$commit`n$sourceHash"
  $actualBuildState = if (Test-Path -LiteralPath $buildStateFile) {
    (Get-Content -LiteralPath $buildStateFile -Raw).Trim()
  }
  else {
    ''
  }

  if ($actualBuildState -ne $expectedBuildState.Trim()) {
    Write-Host 'Source update detected. Dependencies and build output will be refreshed.' -ForegroundColor Yellow
    Invoke-Checked 'Installing dependencies' { corepack "pnpm@$pnpmVersion" install --frozen-lockfile }
    Invoke-Checked 'Building DeepSeek Harness' { corepack "pnpm@$pnpmVersion" run build }
    Set-Content -LiteralPath $buildStateFile -Value $expectedBuildState -Encoding ASCII
  }
  else {
    Write-Host 'Build is current; skipping install and build.' -ForegroundColor Green
  }

  Write-Host "`n== Starting Web UI ==" -ForegroundColor Cyan
  Remove-Item -LiteralPath $launchUrlFile -Force -ErrorAction SilentlyContinue
  $env:DSH_LAUNCH_URL_FILE = $launchUrlFile
  corepack "pnpm@$pnpmVersion" dsh web --no-open
  $serverExitCode = $LASTEXITCODE
  Remove-Item Env:DSH_LAUNCH_URL_FILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $launchUrlFile -Force -ErrorAction SilentlyContinue
  exit $serverExitCode
}
catch {
  Write-Host "`n[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Review the error above, then press Enter to close this window.' -ForegroundColor Yellow
  Read-Host | Out-Null
  exit 1
}
