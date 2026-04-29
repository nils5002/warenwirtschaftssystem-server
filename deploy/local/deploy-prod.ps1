param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [string]$ServerAppDir = "/opt/web/cloud_web",
  [string]$Branch = "main",
  [switch]$SkipPush
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\\..")
Set-Location $RepoRoot

Write-Host "Repo: $RepoRoot"
Write-Host "Server: $Server"
Write-Host "Branch: $Branch"

if (-not $SkipPush) {
  Write-Host "Pushe Branch '$Branch' nach origin ..."
  git push origin $Branch
}

$RemoteCmd = "cd $ServerAppDir && sh deploy/server/deploy.sh $Branch"
Write-Host "Starte Remote-Deploy ..."
ssh $Server $RemoteCmd

Write-Host "Deploy-Trigger abgeschlossen."
