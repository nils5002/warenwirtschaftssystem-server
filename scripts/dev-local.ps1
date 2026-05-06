$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Local-only defaults for predictable login and isolated DB.
$env:APP_ENV = "development"
$env:DATABASE_URL = "sqlite:///./app/data/app.local.db"
$env:DB_AUTO_CREATE_SCHEMA = "true"
$env:WMS_SEED_LEGACY_ON_STARTUP = "false"
$env:INITIAL_ADMIN_EMAIL = "admin@example.com"
$env:INITIAL_ADMIN_PASSWORD = "Admin123!"
$env:INITIAL_ADMIN_NAME = "Admin"
$env:AUTH_TOKEN_SECRET = "local-dev-secret-change-me"
$env:CORS_ORIGINS = "http://localhost:4173,http://127.0.0.1:4173,http://localhost:4174,http://127.0.0.1:4174"

Write-Host "Starte Local Dev (Backend + Frontend) mit fixer Local-Anmeldung..."
Write-Host "Login: admin@example.com / Admin123!"

npm run dev
