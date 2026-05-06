$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$dbPath = Join-Path $repoRoot "backend\app\data\app.local.db"

if (Test-Path $dbPath) {
    Remove-Item -LiteralPath $dbPath -Force
    Write-Host "Lokale Dev-Datenbank entfernt: $dbPath"
}

& (Join-Path $PSScriptRoot "dev-local.ps1")
