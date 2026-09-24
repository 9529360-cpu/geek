param(
  [ValidateSet('probe', 'pre-update', 'post-update')]
  [string]$Phase = 'probe',
  [string]$OutputDir = (Join-Path $PWD 'real-client-evidence')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-FileMetadata([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return [ordered]@{ exists = $false }
  }
  $item = Get-Item -LiteralPath $Path
  return [ordered]@{
    exists = $true
    bytes = [int64]$item.Length
    lastWriteUtc = $item.LastWriteTimeUtc.ToString('o')
  }
}

function Get-DirectorySummary([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    return [ordered]@{ exists = $false; childDirectoryCount = 0 }
  }
  $count = @(Get-ChildItem -LiteralPath $Path -Directory -Force -ErrorAction SilentlyContinue).Count
  return [ordered]@{ exists = $true; childDirectoryCount = $count }
}

function Get-OptionalPropertyValue([object]$InputObject, [string]$Name) {
  if ($null -eq $InputObject) { return $null }
  $property = $InputObject.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-UninstallEntries {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($root in $roots) {
    Get-ItemProperty $root -ErrorAction SilentlyContinue |
      Where-Object {
        $displayName = [string](Get-OptionalPropertyValue $_ 'DisplayName')
        $displayName -and $displayName -match '(?i)^(极客|Geek)(\s|$)'
      }
  }
}

function Get-GeekExecutable {
  $candidates = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in @(Get-UninstallEntries)) {
    $displayIcon = Get-OptionalPropertyValue $entry 'DisplayIcon'
    if ($displayIcon) {
      $icon = [string]$displayIcon
      $icon = $icon.Trim('"') -replace ',\d+$', ''
      if ($icon) { $candidates.Add($icon) }
    }
    $installLocation = Get-OptionalPropertyValue $entry 'InstallLocation'
    if ($installLocation) {
      foreach ($name in @('极客.exe', 'geek.exe', 'Geek.exe')) {
        $candidates.Add((Join-Path ([string]$installLocation) $name))
      }
    }
  }

  foreach ($candidate in @(
    (Join-Path $env:LOCALAPPDATA 'Programs\极客\极客.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\geek\极客.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\geek\geek.exe')
  )) { $candidates.Add($candidate) }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  return $null
}

function Get-InstalledVersion([string]$ExecutablePath) {
  if (-not $ExecutablePath) { return $null }
  $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($ExecutablePath)
  foreach ($value in @($info.ProductVersion, $info.FileVersion)) {
    if ($value -and $value -match '^\d+\.\d+\.\d+') {
      return $Matches[0]
    }
  }
  return $null
}

function Get-ProcessState([string]$ExecutablePath) {
  $processes = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -match '(?i)^(极客|geek)$'
  })
  return [ordered]@{
    running = $processes.Count -gt 0
    processCount = $processes.Count
    executableDetected = [bool]$ExecutablePath
  }
}

function Get-Snapshot([string]$SnapshotPhase) {
  $exe = Get-GeekExecutable
  $version = Get-InstalledVersion $exe
  $userData = Join-Path $env:APPDATA 'geek'
  $partitions = Join-Path $userData 'Partitions'

  return [ordered]@{
    schema = 1
    issue = 95
    phase = $SnapshotPhase
    capturedUtc = (Get-Date).ToUniversalTime().ToString('o')
    os = [ordered]@{
      platform = 'windows'
      architecture = $env:PROCESSOR_ARCHITECTURE
    }
    client = [ordered]@{
      installed = [bool]$exe
      version = $version
      process = Get-ProcessState $exe
    }
    userData = [ordered]@{
      exists = (Test-Path -LiteralPath $userData -PathType Container)
      accounts = Get-FileMetadata (Join-Path $userData 'accounts.json')
      config = Get-FileMetadata (Join-Path $userData 'config.json')
      partitions = Get-DirectorySummary $partitions
      lineTokenStorePresent = (Test-Path -LiteralPath (Join-Path $userData 'line-tokens.json') -PathType Leaf)
    }
    privacy = [ordered]@{
      rawAccountDataIncluded = $false
      cookieDataIncluded = $false
      tokensIncluded = $false
      chatContentIncluded = $false
      pathsIncluded = $false
    }
  }
}

function Compare-Snapshots($Before, $After) {
  $sameAccountFilePresence = $Before.userData.accounts.exists -eq $After.userData.accounts.exists
  $sameConfigPresence = $Before.userData.config.exists -eq $After.userData.config.exists
  $partitionCountPreserved = $Before.userData.partitions.childDirectoryCount -eq $After.userData.partitions.childDirectoryCount
  $lineTokenPresencePreserved = $Before.userData.lineTokenStorePresent -eq $After.userData.lineTokenStorePresent

  return [ordered]@{
    schema = 1
    issue = 95
    comparedUtc = (Get-Date).ToUniversalTime().ToString('o')
    beforeVersion = $Before.client.version
    afterVersion = $After.client.version
    upgradedFrom128To129 = ($Before.client.version -eq '1.2.8' -and $After.client.version -eq '1.2.9')
    appRunningAfter = [bool]$After.client.process.running
    structuralState = [ordered]@{
      accountFilePresencePreserved = $sameAccountFilePresence
      configFilePresencePreserved = $sameConfigPresence
      partitionCountPreserved = $partitionCountPreserved
      lineTokenStorePresencePreserved = $lineTokenPresencePreserved
    }
    requiresManualUiConfirmation = $true
    privacy = [ordered]@{
      rawAccountDataIncluded = $false
      cookieDataIncluded = $false
      tokensIncluded = $false
      chatContentIncluded = $false
    }
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$snapshot = Get-Snapshot $Phase
$snapshotPath = Join-Path $OutputDir "$Phase.json"
$snapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $snapshotPath -Encoding UTF8

$stateRoot = Join-Path $env:LOCALAPPDATA 'GeekRegression\issue-95'
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null

if ($Phase -eq 'pre-update') {
  if ($snapshot.client.version -ne '1.2.8') {
    throw "Pre-update evidence requires installed Geek 1.2.8; detected '$($snapshot.client.version)'. No downgrade was attempted."
  }
  $snapshot | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $stateRoot 'pre-update.json') -Encoding UTF8
}

if ($Phase -eq 'post-update') {
  if ($snapshot.client.version -ne '1.2.9') {
    throw "Post-update evidence requires installed Geek 1.2.9; detected '$($snapshot.client.version)'."
  }
  $prePath = Join-Path $stateRoot 'pre-update.json'
  if (-not (Test-Path -LiteralPath $prePath -PathType Leaf)) {
    throw 'Missing local pre-update baseline. Run the pre-update phase on this same Windows user profile first.'
  }
  $before = Get-Content -LiteralPath $prePath -Raw | ConvertFrom-Json
  $comparison = Compare-Snapshots $before $snapshot
  $comparison | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDir 'comparison.json') -Encoding UTF8
}

Write-Host "Geek real-client evidence phase: $Phase"
Write-Host "Installed version: $($snapshot.client.version)"
Write-Host "Client running: $($snapshot.client.process.running)"
Write-Host "Partition count: $($snapshot.userData.partitions.childDirectoryCount)"
Write-Host 'Sensitive account contents, cookies, tokens, chat text, and raw paths were not emitted.'
