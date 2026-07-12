---
name: test
description: Tests und Build-Checks dieses Repos korrekt ausführen (Backend-Pytest, Frontend-Vitest/Build, Playwright-Smoke) — inkl. CWD-, DB-Isolations- und Flake-Gotchas. Nutzen für jede Test-/Validierungsaufgabe.
---

# Tests & Build-Checks

## Backend (pytest)

**Immer aus `backend/` starten** (sonst `ModuleNotFoundError: app`) und **System-Python**
verwenden — es existiert kein venv im Repo:

```bash
cd backend
python -m pytest tests
```

Einzelner Test: `python -m pytest tests/test_xyz.py -k "case" -x`

### Gotchas

- **Suite ist nicht DB-isoliert**: Ohne Override läuft sie gegen die persistente
  `app/data/app.db` → Datenstand-Flakes. Für einen sauberen Lauf frische DB erzwingen:

  ```bash
  cd backend
  DATABASE_URL="sqlite:///./app/data/app.pytest.db" python -m pytest tests
  rm -f app/data/app.pytest.db
  ```

- Bekannter Flake: `test_tampered_token_is_rejected` kann im Gesamtlauf rot sein
  (fehlende DB-Isolation), isoliert grün — erst isoliert wiederholen, bevor man
  eine Regression annimmt.
- `conftest.py` setzt Test-Env (Cache-TTL 0, `TRUST_PROXY_HEADERS=1`, Registrierung an) —
  **vor** dem ersten App-Import; neue env-abhängige Settings dort ergänzen.

## Frontend

```bash
npm --prefix frontend run test    # Vitest (unit)
npm --prefix frontend run build   # Build-Check (DoD-Pflicht)
```

Bekannt: Es gibt einen vorbestehenden tsc-Fehler rund um `loadWms` — nicht durch
eigene Änderungen verursacht, nicht "nebenbei" fixen.

## Backend-Compile-Check (DoD-Pflicht)

```bash
cd backend
python -m compileall app
```

## E2E-Smoke (Playwright)

`frontend/scripts/ui-smoke.mjs` — kompletter UI-Durchlauf (User/Asset/Planung CRUD):

- Erwartet die App auf **`http://localhost:5174/`** (im Skript hartkodiert) —
  also eine Vite-Instanz auf 5174 starten oder das Skript-BASE_URL-Verhalten beachten.
- Credentials via Env: `SMOKE_USER` / `SMOKE_PASSWORD` (Default-Passwort `Willkommen123!`).
- Legt Testdaten mit Zeitstempel-Suffix an und räumt per API wieder auf.
- Playwright-Gotcha: das Update-Notes-Modal kann nach Login Klicks blockieren — ggf.
  zuerst schließen.

### Ad-hoc-Browser-Checks (ohne Playwright-Browser-Download)

Für schnelle UI-Verifikation im Scratchpad: `npm i playwright-core` und lokales Chrome
per `executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'` starten.

- Login-Feld-Selektor: `input[autocomplete="email"]` (es gibt **kein** `type="email"`).
- Auth ist Cookie-basiert (`wms_auth`, HttpOnly, same-origin) — `page.request` teilt
  den Cookie nach UI-Login, damit sind API-Aufrufe im selben Kontext authentifiziert.
- Asset-Status-Enums sind ASCII (`Verfuegbar`, nicht `Verfügbar`); Umlaute über
  Git-Bash-Heredocs an Python/curl werden cp1252-verstümmelt — ASCII verwenden
  oder Dateien schreiben.

## Definition of Done (aus CLAUDE.md)

Frontend-Build + `compileall` grün, betroffene Tests angepasst, keine sensiblen
Dateien getrackt (`git ls-files Hardwarebestand/*` muss leer sein), Kurzbericht.
