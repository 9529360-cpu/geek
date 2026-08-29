param(
  [string]$RepoUrl = 'https://github.com/9529360-cpu/geek',
  [string]$RunnerRoot = 'C:\geek-ci-runner',
  [string]$RunnerName = $env:COMPUTERNAME + '-geek-ci',
  [string]$Labels = 'geek-ci'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Require-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell window.'
  }
}

Require-Admin

if (Test-Path (Join-Path $RunnerRoot '.runner')) {
  throw "A GitHub Actions runner is already configured in $RunnerRoot. Remove or choose another RunnerRoot before continuing."
}

$tokenSecure = Read-Host 'Paste the temporary GitHub runner registration token' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenSecure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  if ([string]::IsNullOrWhiteSpace($token)) { throw 'Registration token is required.' }

  New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null
  $release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'geek-ci-runner-bootstrap' } -Uri 'https://api.github.com/repos/actions/runner/releases/latest'
  $asset = $release.assets | Where-Object { $_.name -match '^actions-runner-win-x64-.*\.zip$' } | Select-Object -First 1
  if (-not $asset) { throw 'Could not find latest Windows x64 GitHub Actions runner asset.' }

  $zip = Join-Path $env:TEMP $asset.name
  Invoke-WebRequest -Headers @{ 'User-Agent' = 'geek-ci-runner-bootstrap' } -Uri $asset.browser_download_url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $RunnerRoot -Force
  Remove-Item $zip -Force -ErrorAction SilentlyContinue

  Push-Location $RunnerRoot
  try {
    & .\config.cmd --unattended --url $RepoUrl --token $token --name $RunnerName --labels $Labels --work '_work' --runasservice --replace
    if ($LASTEXITCODE -ne 0) { throw "Runner configuration failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $token = $null
  $tokenSecure = $null
}

Write-Host "Geek CI runner configured: $RunnerName"
Write-Host "Labels: self-hosted, Windows, X64, $Labels"
Write-Host "Root: $RunnerRoot"
Write-Host 'Keep this machine free of real Geek userData and production secrets.'
