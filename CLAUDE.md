# CLAUDE.md

Arbeitsleitfaden fuer Claude Code in diesem Repository.

Diese Datei ist verbindlich fuer alle Aenderungen in `D:\DEV\cloud_web`.

## 1) Projektziel (kurz)

Hardware-Warenwirtschaft mit Einsatzplanung:
- Bestand verwalten (Inventar, QR, Status)
- projektbezogene Planung (Availability/Engpaesse)
- Ausgabe/Rueckgabe auf Person + Projekt
- Defekt/Wartung fachlich korrekt steuern

## 2) Source of Truth

Vor jeder groesseren Aufgabe lesen und beachten:
- `PROJECT_CONTEXT.md`
- `AGENTS.md`

Wenn Regeln kollidieren:
1. Sicherheit/Datenschutz
2. Fachlogik aus `PROJECT_CONTEXT.md`
3. Entwicklungsregeln aus `AGENTS.md`
4. Bestehende Code-Struktur

## 3) Harte Projektregeln

1. Kein Full-Rebuild / kein unnötiger Umbau.
2. Bestehende Struktur beibehalten; gezielte Fixes bevorzugen.
3. Keine Runtime-/Cloudflare-/Server-Konfiguration anfassen.
4. Keine Secrets einchecken.
5. Keine echten Bestandsdateien committen.
6. Import bleibt Upload-basiert (kein Ordner-Import reaktivieren).

## 4) Datenschutz & Git Hygiene

### Excel-Dateien
- Lokale Bestandsdateien in `Hardwarebestand/` sind sensibel.
- Niemals echte Inhalte in Doku, Tests oder Commits kopieren.
- Nur synthetische Testdaten in Tests/Template verwenden.

### Muss in `.gitignore` bleiben
- `Hardwarebestand/*.xlsx`
- `Hardwarebestand/*.xlsm`

### Vor Commit immer pruefen
```powershell
git status --short
git ls-files Hardwarebestand/*
```

Erwartung: `git ls-files Hardwarebestand/*` liefert keine echten Dateien.

## 5) Rollen- und Fachregeln

### Rollen
- Admin/Techniker: Stammdaten, Inventar, Kategorien, Defekt/Wartung
- Projektmanager: Planung/Availability
- Mitarbeiter/Junior: Ausgabe/Rueckgabe/Defektmeldung

### Kritische Fachregeln (nicht verletzen)
- Defektmeldung sperrt Asset sofort (`Defekt`).
- `Erledigt` gibt Asset nur frei, wenn **kein** weiterer aktiver Defekt/Wartungseintrag existiert.
- Fehler in Wartungs-Statuspersistenz duerfen keine Folgeupdates ausloesen.
- Check-in darf kein fremdes `lastProject` blind uebernehmen.

## 6) Kategorien (kanonisch)

Standardkategorien:
- Laptop
- iPad
- Handheld
- Smartphone
- QR-Code-Scanner
- Drucker
- Kartendrucker
- Switch
- Router
- LTE-Router
- Zubehoer
- Sonstiges

Regeln:
1. Keine freien Kategorie-Freitexte beim Asset-Onboarding.
2. Neue Kategorien nur im Kategorien-Modul (rollenbasiert).
3. Synonyme zentral normalisieren.
4. Unklare Kategorie => `Zuordnung erforderlich`, nicht blind `Sonstiges`.

## 7) Import/Export Regeln

### Upload-Flow (verbindlich)
- `POST /api/wms/import/preview`
- `POST /api/wms/import/confirm`
- `GET /api/wms/import/template`

Nicht erlaubt:
- "Import aus Ordner Hardwarebestand"
- Dry-Run ueber serverseitige Verzeichnis-Scans aus UI

### Importanforderungen
- Titelzeilen erkennen/ueberspringen.
- Header robust normalisieren (Alias-Listen pflegen).
- Leere Zeilen ignorieren.
- Kategorie aus mehreren Quellen ableiten (Spalte > Header > Sheet > Dateiname > Titel).
- Wenn Name fehlt: sinnvoll auto-generieren.
- Wenn Seriennummer fehlt: deterministische `AUTO-*`-Seriennummer.
- Dedupe-Reihenfolge:
  1) echte Seriennummer
  2) MAC (LAN/WLAN)
  3) Name + Kategorie
  4) IP + Kategorie
  5) `AUTO-*` als technischer Fallback

### Preview-Qualitaet
Preview soll mindestens liefern:
- erkannte Kategorie + Quelle
- erkannte Spalten + Mapping
- valid/new/duplicates/errors
- auto-generierte Namen
- auto-generierte Seriennummern
- unresolved category rows

## 8) Technische Leitplanken

### Backend
- FastAPI + SQLAlchemy Patterns beibehalten.
- Fehler als JSON mit klarer `detail`-Message.
- Keine stillen Folgefehler bei partiellen Fehlschlaegen.

### Frontend
- Bestehende Seiten/Komponenten gezielt erweitern.
- Klare Fehlermeldungen statt "hängen".
- Kritische Requests mit Timeout/sauberem Fehlerpfad.

## 9) Lokaler Workflow

### Starten
```powershell
npm run dev
```

Wenn Portkonflikte:
- pruefen, welcher Prozess auf `5173`/`8000` lauscht
- gezielt den falschen Prozess beenden

### Build/Compile
```powershell
npm --prefix frontend run build
cd backend
python -m compileall app
```

### Tests (wichtig: Arbeitsverzeichnis)
Backend-Tests immer aus `backend` starten:
```powershell
cd D:\DEV\cloud_web\backend
.\.venv\Scripts\python.exe -m pytest tests
```

Wenn stattdessen aus Repo-Root getestet wird, kann `ModuleNotFoundError: app` auftreten.

## 10) Definition of Done (DoD)

Ein Task ist erst fertig, wenn:
1. Fachlogik korrekt implementiert ist.
2. Betroffene Tests angepasst/neu erstellt sind.
3. `frontend build` + `compileall` gruen sind.
4. Keine sensiblen Dateien versehentlich getrackt sind.
5. Kurzbericht vorhanden ist:
   - Ursache
   - geaenderte Dateien
   - Validierung
   - Rest-Risiken

## 11) Commit-Qualitaet

Commit Messages:
- praezise, fachlich, in einem Thema gebuendelt
- Beispiel:
  - `fix(import): robust category inference and deterministic auto-serial fallback`
  - `fix(maintenance): prevent asset release while active defects remain`

Vor Push bei Rejected-Non-Fast-Forward:
```powershell
git pull --rebase origin main
git push origin main
```

## 12) Nicht tun

- Keine echten Excel-Bestaende ins Repo.
- Keine grossen Refactors ohne Auftrag.
- Keine neuen Parallel-Architekturen einziehen.
- Keine "temporären" Workarounds ohne klare Rueckbaustrategie.

---

Wenn unklar ist, was fachlich korrekt ist: zuerst an `PROJECT_CONTEXT.md` ausrichten, dann kleinstmoegliche sichere Aenderung umsetzen.
