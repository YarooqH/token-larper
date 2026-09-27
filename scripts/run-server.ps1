$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$cacheDir = Join-Path $projectRoot ".cache"
$settingsPath = Join-Path $cacheDir "settings.json"
$port = 4269
$openBrowser = $false

try {
  if (Test-Path -LiteralPath $settingsPath) {
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    $savedPort = 0
    if ([int]::TryParse([string]$settings.port, [ref]$savedPort) -and $savedPort -gt 0 -and $savedPort -le 65535) {
      $port = $savedPort
    }
    $openBrowser = $settings.openBrowserOnBoot -eq $true
  }
} catch {
  $port = 4269
  $openBrowser = $false
}

$baseUrl = "http://127.0.0.1:$port"
try {
  $status = Invoke-RestMethod -Uri "$baseUrl/api/tray-status" -TimeoutSec 2
  if ($null -ne $status.shortTooltip) {
    if ($openBrowser) { Start-Process $baseUrl }
    exit 0
  }
} catch {
  # The server is not running yet.
}

try {
  $bunCommand = Get-Command bun.exe -ErrorAction SilentlyContinue
  $bunPath = if ($bunCommand) { $bunCommand.Source } else { Join-Path $env:USERPROFILE ".bun\bin\bun.exe" }
  if (-not (Test-Path -LiteralPath $bunPath)) { throw "Bun was not found at $bunPath" }

  $env:PORT = [string]$port
  $serverEntry = Join-Path $projectRoot "src\server.ts"
  $server = Start-Process -FilePath $bunPath -ArgumentList "`"$serverEntry`"" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    if ($server.HasExited) { throw "Token Larper exited before the dashboard was ready" }
    try {
      $status = Invoke-RestMethod -Uri "$baseUrl/api/tray-status" -TimeoutSec 1
      if ($null -ne $status.shortTooltip) { $ready = $true; break }
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $ready) { throw "Token Larper did not respond on port $port" }
  Remove-Item -LiteralPath (Join-Path $cacheDir "startup-error.log") -ErrorAction SilentlyContinue
  if ($openBrowser) { Start-Process $baseUrl }
} catch {
  New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $cacheDir "startup-error.log") -Value $_.Exception.Message
  exit 1
}
