# Stabilitäts- & Härtungspaket

Ergänzendes Betriebs-Dokument nach dem `/api/wms/overview`-Performance-Fix
(`perf(overview): entlaste polling und cache overview kurzzeitig`).

Dieses Dokument hält **kleine, sichere Härtungen** und **operative Empfehlungen**
fest. Es ändert **keine** Fachlogik, **keine** Infrastruktur (Cloudflare / FritzBox /
Nginx Proxy Manager) und **keine** produktive Datenbank.

Stand: 2026-05-19

---

## 1) Kurzbewertung

| Bereich        | Status | Begründung |
|----------------|--------|------------|
| Frontend       | 🟢 grün | Polling nur bei Login, Hintergrund-Tab-Pause, Single-Flight, Abort-and-Replace — ergänzt um Watchdog-Timeout gegen hängende Requests. |
| Backend        | 🟢 grün | Kurz-Cache + Single-Flight für Overview, kontrollierte Fehler-Handler, Slow-Request-Logging ergänzt. |
| NPM / Proxy    | 🟡 gelb | Funktioniert (externer Lasttest stabil). Nicht code-seitig prüfbar — Port-Exposition siehe Abschnitt 5. |
| Datenbank      | 🟡 gelb | SQLite + WAL ist für die aktuelle Last ausreichend (Lasttest stabil). Single-Worker bleibt die Grenze — siehe Abschnitt 7. |
| Monitoring     | 🟡 gelb | `/health` + `/health/ready` vorhanden und sauber getrennt. Externe Überwachung (Uptime-Kuma) noch einzurichten — Abschnitt 4. |
| Security       | 🟡 gelb | App-seitig gehärtet (CSP, Security-Header, HttpOnly-Cookie, RBAC). Netzwerk-Exposition nicht code-seitig prüfbar — Checkliste Abschnitt 5. |
| Backup/Restore | 🟡 gelb | Export/Import-Endpoints vorhanden. Automatisiertes Backup + Restore-Test noch einzurichten — Abschnitt 6. |

🟢 = keine Maßnahme nötig · 🟡 = Empfehlung offen, kein akuter Notfall · 🔴 = sofort handeln (aktuell keiner)

---

## 2) Umgesetzte Härtungen (Code)

Alle Änderungen sind klein, observability-/robustheitsorientiert und ohne Fachlogik-Bezug.

1. **Frontend — Watchdog-Timeout für Overview-Requests**
   (`frontend/src/hooks/useWmsController.ts`)
   Ein einzelner `/api/wms/overview`-Request wird nach **15 s** abgebrochen.
   Ohne dieses Limit konnte ein auf schwacher Mobilfunkverbindung „halb offen"
   hängender Request das Polling dauerhaft blockieren (der `inflight`-Guard löst
   nie auf) und die UI im Lade-/Refresh-Zustand einfrieren. Der Timeout-Abbruch
   wird klar vom Abort-and-Replace getrennt: Ersterer löst Fehlermeldung +
   Backoff aus, Letzterer nicht.

2. **Backend — Slow-Request-Logging** (`backend/app/main.py`)
   Die `request_logging`-Middleware misst nun die Bearbeitungsdauer. Requests
   über **1000 ms** werden als `WARNING` markiert (inkl. Request-ID/Pfad/Status
   über den bestehenden Logging-Filter). Schneller Normalbetrieb flutet die Logs
   nicht.

3. **Backend — Overview-Cache Hit/Miss debugbar**
   (`backend/app/services/overview_cache.py`)
   Prozessweite Zähler `hits`/`misses` + `stats()`-Funktion. Pro Zugriff eine
   `DEBUG`-Logzeile mit laufender Hit-Rate. `DEBUG` ist im Normalbetrieb
   (Root-Logger `INFO`) unsichtbar — zum Debuggen gezielt den Logger
   `cloud_web.overview_cache` auf `DEBUG` heben.

4. **Git-Hygiene** (`.gitignore`)
   `*.db-wal`, `*.db-shm`, `*.db-journal` ergänzt; die bereits versehentlich
   getrackten SQLite-Laufzeitdateien `app.db-shm` / `app.db-wal` aus der
   Versionskontrolle entfernt (`git rm --cached`, lokale Dateien bleiben
   erhalten).

### Bereits vorhanden (geprüft, unverändert gut)
- Polling nur bei `isAuthenticated`, Pause im Hintergrund-Tab via
  `visibilitychange`, Single-Flight + Abort-and-Replace, exponentieller Backoff
  (45 s → max. 120 s).
- 401-Handling: zentraler `unauthorizedHandler` verwirft die Session und
  schaltet sauber auf die Login-Seite.
- **Cache-Invalidierung ist vollständig**: ein SQLAlchemy-`after_commit`-Event
  verwirft den Overview-Cache nach **jeder** committeten Schreibtransaktion —
  Asset anlegen/ändern/löschen, Ausgabe/Rücknahme, Defekt/Wartung, Planung,
  Kategorie- und Benutzeränderungen sowie Import/Backup sind damit automatisch
  abgedeckt, ohne Service-Methoden einzeln zu dekorieren.
- `/health` ist schlank (kein DB-Zugriff); `/health/ready` prüft App + DB und
  liefert bei DB-Problemen eine kontrollierte 503.

---

## 3) Monitoring-Empfehlungen (Uptime-Kuma) — *nicht automatisch geändert*

Drei HTTP(s)-Monitore einrichten:

| Monitor | URL | Erwartung | Intervall |
|---------|-----|-----------|-----------|
| Liveness | `https://test.nilshome.loan/health` | HTTP 200 | 60 s |
| Readiness | `https://test.nilshome.loan/health/ready` | HTTP 200 (503 = DB-Problem) | 60–120 s |
| Frontend | `https://test.nilshome.loan/` | HTTP 200 | 120 s |

Hinweise:
- Für Readiness die akzeptierten Statuscodes auf `200-299` setzen — eine 503
  ist ein **gewollter** kontrollierter Fehler und soll als „down" alarmieren.
- **Response-Time-Warnung (> 2 s):** Uptime-Kuma hat keinen nativen
  Schwellwert-Alarm auf die Antwortzeit. Pragmatische Lösung: einen zusätzlichen
  „Latenz-Canary"-Monitor auf `/health` mit **Request-Timeout 2 s** anlegen —
  überschreitet die Antwort 2 s, geht dieser Monitor auf „down" und alarmiert.
  Die regulären Monitore behalten einen großzügigen Timeout (z. B. 10 s).
- Benachrichtigung (E-Mail/Telegram/…) an mindestens einen Monitor hängen.

---

## 4) Security-Checkliste (Netzwerk) — *nur prüfen, nicht ändern*

Nicht code-seitig verifizierbar — bitte manuell kontrollieren:

- [ ] **FritzBox Portfreigaben:** nur **80** und **443** auf den NPM-Host
      weiterleiten. Keine weiteren Weiterleitungen.
- [ ] **NPM-Admin (81)** nicht aus dem Internet erreichbar.
- [ ] **Portainer (9443 / 9000)** nicht aus dem Internet erreichbar.
- [ ] **Backend (8001)** nicht aus dem Internet erreichbar.
- [ ] **Frontend (8080)** nicht aus dem Internet erreichbar (öffentlich nur
      via NPM auf 443).
- [ ] Test von extern (Mobilfunk): `https://test.nilshome.loan` erreichbar,
      die o. g. Ports von extern **nicht**.

Code-seitige Beobachtung zur Docker-Port-Exposition:
- `docker-compose.yml` (Basis) veröffentlicht `BACKEND_PORT:-8001 → 8000` und
  `FRONTEND_PORT:-8080 → 4173` auf **allen** Host-Interfaces (Docker-Default
  `0.0.0.0`).
- `deploy/server/example-runtime/docker-compose.prod.yml.example` setzt für das
  Backend `ports: []` — d. h. in Produktion soll das Backend **nicht** host-
  veröffentlicht werden, sondern nur über das Docker-Netz / NPM erreichbar sein.
- **Empfehlung:** sicherstellen, dass der LIVE-Stack die Prod-Override nutzt
  (Backend ohne Host-Port). Alternativ in der Compose-Datei die Ports an
  `127.0.0.1` binden (`"127.0.0.1:8080:4173"`). *Beides ist ein Compose-/
  Redeploy-Eingriff und daher hier bewusst nicht umgesetzt.*
- **Hinweis (optional):** Cloudflare steht auf „DNS only" (grauer Wolke) — die
  öffentliche Origin-IP ist damit sichtbar, kein Cloudflare-WAF/DDoS-Schutz
  davor. Ein Wechsel auf „Proxied" wäre eine Cloudflare-Änderung und ist nicht
  Teil dieses Pakets.

---

## 5) Backup-/Restore-Empfehlung — *nur Empfehlung, nichts geändert*

- **Tägliches Backup** des SQLite-Datenstands. Sauberer Weg ist
  `sqlite3 app.db ".backup '<ziel>'"` (konsistent inkl. WAL) **oder** der
  vorhandene App-Export `GET /api/wms/backup/export` (JSON).
- Backup-Ziel **außerhalb** des Docker-Volumes `warehouse_app_data` ablegen
  (idealerweise anderer Host / Proxmox-Backup), damit ein Volume-Verlust nicht
  auch die Backups mitnimmt.
- **Regelmäßiger Restore-Test** in einer isolierten Testumgebung (separater
  Container / lokale Kopie) — ein ungetestetes Backup ist kein Backup.
- SQLite-Laufzeitdateien `app.db-wal` / `app.db-shm` / `*.db-journal` **nie**
  committen — jetzt in `.gitignore` abgedeckt.
- Produktive Backups niemals verändern; Restore-Tests immer auf Kopien.

---

## 6) PostgreSQL — Einordnung (keine Umsetzung)

PostgreSQL bleibt **langfristig sinnvoll**, sobald mehr parallele Schreib-
zugriffe und ein Multi-Worker-Betrieb nötig werden. **Aktuell kein Notfall** —
der externe Overview-Lasttest war stabil (Concurrency 20, 100 Requests, avg
~496 ms, p95 ~672 ms, keine Timeouts/5xx). Der Engpass ist der einzelne
uvicorn-Worker (GIL), nicht SQLite.

Geplanter Migrationsweg (späteres, eigenes Paket):
1. Analyse (Schema-/Query-Kompatibilität, Alembic-Stand)
2. PostgreSQL **parallel** aufsetzen
3. Testimport aus Backup
4. Lasttest gegen PostgreSQL
5. Umschaltung
6. Rollback bereithalten

---

## 7) Offene Empfehlungen (nicht umgesetzt)

- **Test-Isolation:** Die Backend-Tests laufen gegen die persistente Datei
  `backend/app/data/app.db`. Akkumulierte Daten können reihenfolge-/lauf-
  abhängige Flakes verursachen (z. B. `UNIQUE constraint failed:
  assets.tag_number`). Gegen eine **frische** DB sind alle Tests grün (229/229
  verifiziert). Empfehlung: in `conftest.py` eine isolierte Test-DB verwenden
  (eigene Datei pro Session + Wipe, oder `:memory:`).
- Uptime-Kuma-Monitore einrichten (Abschnitt 3).
- Netzwerk-/Firewall-Prüfung durchführen (Abschnitt 4).
- Automatisiertes tägliches Backup + Restore-Test (Abschnitt 5).
- PostgreSQL-Migration als eigenes Paket (Abschnitt 6).
