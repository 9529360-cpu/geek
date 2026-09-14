param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    'translation-off-enter',
    'translation-off-button',
    'translation-on-send',
    'translation-failure-recovery',
    'busy-chat-send',
    'webview-reload-send',
    'app-cold-start-send',
    'quota-valid',
    'quota-zero',
    'subscription-logged-out',
    'upgraded-profile',
    'direct-chat',
    'lid-chat',
    'broadcast-control'
  )]
  [string]$Case,

  [Parameter(Mandatory = $true)]
  [ValidateSet('pass', 'fail', 'blocked', 'not-applicable')]
  [string]$Result,

  [ValidateSet('present', 'missing', 'unknown', 'not-applicable')]
  [string]$BridgeMarker = 'unknown',

  [ValidateSet('ready', 'waiting', 'unknown', 'not-applicable')]
  [string]$SendHook = 'unknown',

  [ValidateSet('accepted', 'bridge-capacity', 'auth', 'quota', 'deadline', 'gateway', 'quality', 'cancelled', 'not-applicable', 'unknown')]
  [string]$Admission = 'unknown',

  [ValidateSet('none', 'once', 'multiple', 'unknown', 'not-applicable')]
  [string]$NativeSend = 'unknown',

  [ValidateSet('yes', 'no', 'unknown', 'not-applicable')]
  [string]$ExactlyOnce = 'unknown',

  [ValidateSet('yes', 'no', 'unknown', 'not-applicable')]
  [string]$DraftRecovered = 'not-applicable',

  [ValidateSet('direct', 'lid', 'not-applicable', 'unknown')]
  [string]$Addressing = 'not-applicable',

  [ValidateSet('lt-1s', '1-5s', '5-15s', '15-30s', '30-35s', 'ge-35s', 'unknown', 'not-applicable')]
  [string]$ElapsedBucket = 'unknown',

  [ValidateSet('valid', 'zero', 'logged-out', 'expired', 'unknown', 'not-applicable')]
  [string]$UserReadiness = 'not-applicable',

  [ValidateSet('fresh', 'upgraded', 'unknown', 'not-applicable')]
  [string]$ProfileKind = 'not-applicable',

  [ValidateSet('none', 'native-send', 'translation', 'bridge', 'auth', 'quota', 'deadline', 'gateway', 'quality', 'composer', 'unknown')]
  [string]$FailureDomain = 'none',

  [string]$Revision = '',
  [string]$OutputDir = (Join-Path $PWD 'real-client-evidence\translation')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-SafeRevision([string]$Requested) {
  $candidate = [string]$Requested
  if ($candidate -and $candidate -notmatch '^[a-fA-F0-9]{7,40}$') {
    throw 'Revision must be a 7-40 character hexadecimal Git commit id.'
  }
  if ($candidate) { return $candidate.ToLowerInvariant() }

  try {
    $resolved = (& git rev-parse HEAD 2>$null | Select-Object -First 1)
    if ($resolved -and [string]$resolved -match '^[a-fA-F0-9]{40}$') {
      return ([string]$resolved).ToLowerInvariant()
    }
  } catch {}
  return $null
}

function Get-DeclaredWaJsVersion {
  try {
    $packagePath = Join-Path $PWD 'package.json'
    if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { return $null }
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $value = [string]$package.dependencies.'@wppconnect/wa-js'
    if ($value -match '^[~^]?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$') { return $value }
  } catch {}
  return $null
}

function Get-InstalledGeekVersion {
  $roots = @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  foreach ($root in $roots) {
    foreach ($entry in @(Get-ItemProperty $root -ErrorAction SilentlyContinue)) {
      if (-not $entry.DisplayName -or $entry.DisplayName -notmatch '(?i)^(极客|Geek)(\s|$)') { continue }
      $displayVersion = [string]$entry.DisplayVersion
      if ($displayVersion -match '^\d+\.\d+\.\d+') { return $Matches[0] }
    }
  }
  return $null
}

$revisionValue = Get-SafeRevision $Revision
$record = [ordered]@{
  schema = 1
  issue = 526
  capturedUtc = (Get-Date).ToUniversalTime().ToString('o')
  candidate = [ordered]@{
    revision = $revisionValue
    installedVersion = Get-InstalledGeekVersion
    declaredWaJsVersion = Get-DeclaredWaJsVersion
  }
  smoke = [ordered]@{
    case = $Case
    result = $Result
    bridgeMarker = $BridgeMarker
    sendHook = $SendHook
    admission = $Admission
    nativeSend = $NativeSend
    exactlyOnce = $ExactlyOnce
    draftRecovered = $DraftRecovered
    addressing = $Addressing
    elapsedBucket = $ElapsedBucket
    userReadiness = $UserReadiness
    profileKind = $ProfileKind
    failureDomain = $FailureDomain
  }
  evidenceBoundary = [ordered]@{
    authenticatedRealClient = $true
    operatorObserved = $true
    automatedMessageSend = $false
    releaseGate = $false
  }
  privacy = [ordered]@{
    messageContentIncluded = $false
    translatedContentIncluded = $false
    conversationIdentifierIncluded = $false
    phoneNumberIncluded = $false
    accountIdentifierIncluded = $false
    cookieDataIncluded = $false
    authTokenIncluded = $false
    bridgeTokenIncluded = $false
    providerSecretIncluded = $false
    rawProfilePathIncluded = $false
  }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
$safeCase = $Case -replace '[^a-z0-9-]', '-'
$outputPath = Join-Path $OutputDir "$stamp-$safeCase.json"
$record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding UTF8

Write-Host "Geek translation real-client evidence: $Case => $Result"
Write-Host "Revision: $revisionValue"
Write-Host "Installed version: $($record.candidate.installedVersion)"
Write-Host "WA-JS declaration: $($record.candidate.declaredWaJsVersion)"
Write-Host 'No message text, translation text, conversation/contact ids, phone numbers, cookies, tokens, secrets, or raw profile paths were collected.'
