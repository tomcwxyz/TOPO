param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [ValidateSet('Chrome', 'Edge', 'Both')]
  [string]$Browser = 'Both',

  [string]$HostExe = '',

  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$HostName = 'uk.co.goodship.topo.capture'
$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $SkipBuild) {
  Push-Location $RepoRoot
  try {
    Write-Host 'Building TOPO native capture host...'
    cargo build --release --manifest-path crates/topo-native-host/Cargo.toml
  }
  finally {
    Pop-Location
  }
}

if ([string]::IsNullOrWhiteSpace($HostExe)) {
  $HostExe = Join-Path $RepoRoot 'target\release\topo-native-host.exe'
}

if (-not (Test-Path -LiteralPath $HostExe -PathType Leaf)) {
  throw "Native host executable not found: $HostExe"
}

$HostExe = (Resolve-Path -LiteralPath $HostExe).Path
$ManifestDirectory = Join-Path $env:LOCALAPPDATA 'TOPO\native-messaging'
New-Item -ItemType Directory -Path $ManifestDirectory -Force | Out-Null
$ManifestPath = Join-Path $ManifestDirectory "$HostName.json"

$manifest = [ordered]@{
  name = $HostName
  description = 'Local bridge for governed TOPO AI conversation capture'
  path = $HostExe
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$json = $manifest | ConvertTo-Json -Depth 5
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ManifestPath, $json, $utf8NoBom)

$registryKeys = @()
if ($Browser -eq 'Chrome' -or $Browser -eq 'Both') {
  $registryKeys += "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
}
if ($Browser -eq 'Edge' -or $Browser -eq 'Both') {
  $registryKeys += "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
}

foreach ($key in $registryKeys) {
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $ManifestPath
  Write-Host "Registered $HostName at $key"
}

Write-Host ''
Write-Host 'TOPO native capture host registered.'
Write-Host "Manifest: $ManifestPath"
Write-Host "Executable: $HostExe"
Write-Host "Allowed extension: $ExtensionId"
Write-Host ''
Write-Host 'Restart Chrome/Edge if it was already open, then enable TOPO capture on a supported AI page.'
