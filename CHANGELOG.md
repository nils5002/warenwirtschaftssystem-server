# Changelog

Alle relevanten Änderungen an diesem Projekt werden hier dokumentiert.

## [Unreleased]

### Hinzugefügt
- Adminseite „Systemupdate": Versionsvergleich gegen den konfigurierten
  GitHub-Branch und Redeploy des Portainer-Stacks direkt aus dem WWS — ein
  Portainer-Login ist für normale Updates nicht mehr nötig.
- Neue Admin-Endpunkte `/api/admin/system/version`, `/update/check`, `/update`,
  `/update/status`, `/update/history` (Rolle **und** Recht `system.update`).
- Automatisches, validiertes Backup vor jedem Update (ZIP mit vollständigem
  Datenexport plus Login-Hintergründen und Produktbild-Cache) im persistenten
  Datenverzeichnis; schlägt es fehl, wird kein Redeploy ausgelöst.
- Updatehistorie inkl. ausführendem Admin, Quell-/Zielversion, Backup-Verweis
  und Ergebnis nach dem Neustart.
- Automatische Erkennung der laufenden Version: Das Backend-Image liest den
  Commit beim Build aus dem Git-Checkout (Build-Kontext ist jetzt das Repo-Root,
  `dockerfile: backend/Dockerfile`) und legt ihn als `build_info.json` ins Image.
  `.git` landet nicht im Laufzeit-Image.
- Zielversion beim Redeploy als Webhook-Parameter: Der Update-Aufruf hängt
  `?APP_GIT_COMMIT=<sha>&APP_GIT_BRANCH=<branch>` an den Portainer-Stack-Webhook.
  Portainer übernimmt beides als Stack-Variablen, `docker-compose.yml` reicht sie
  als Build-Args ins Image. Nötig, weil Portainer Git-Stacks **ohne `.git`**
  auscheckt (2.39 geprüft) und die Ableitung beim Build dort leer bleibt.
  Abschaltbar über `SYSTEM_UPDATE_PASS_BUILD_METADATA=false`.
- Neue Umgebungsvariablen: `SYSTEM_UPDATE_ENABLED` (Default **aus**),
  `PORTAINER_STACK_WEBHOOK_URL`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH`,
  `GITHUB_API_TOKEN`, `SYSTEM_UPDATE_TIMEOUT_SECONDS`,
  `SYSTEM_UPDATE_PASS_BUILD_METADATA` (Default **an**). `APP_GIT_COMMIT` und
  `APP_GIT_BRANCH` bleiben unter Portainer gesetzt und werden beim Update
  automatisch aktualisiert; `APP_BUILD_TIME` ist eine reine Überschreibung.

- Erfolgsnachweis über die **Buildzeit**: Lässt sich der laufende Commit nicht
  feststellen (Portainer checkt Git-Stacks ohne `.git` aus, und der
  GitOps-Webhook übernimmt entgegen der Dokumentation keine Query-Parameter),
  belegt eine geänderte Buildzeit in `build_info.json`, dass der Redeploy
  gegriffen hat. Der Zielcommit wird danach als bestätigte Version gespeichert
  und gilt, solange ein Image mit dieser Buildzeit läuft — danach gilt die
  Version wieder als unbekannt statt veraltet. Neue Spalten
  `system_update_runs.source_build_time` / `.detected_build_time` (idempotenter
  Startup-Patch).
- Reihenfolge der Versionsermittlung neu: `build_info.json` → bestätigte Version
  aus der Datenbank → `APP_GIT_COMMIT`. Die von Hand gepflegte Variable steht
  bewusst hinten, weil sie mit dem nächsten Redeploy veraltet.
- Verbindungsfehler beim Redeploy werden benannt statt pauschal als „nicht
  erreichbar" gemeldet: TLS-Zertifikat, Zeitüberschreitung, ungültige URL und
  fehlende Route sind jetzt unterscheidbar. Die URL bleibt in Meldung und Log
  maskiert, geloggt wird zusätzlich der Ausnahmetyp.

### Hinweise
- Die Webhook-URL muss aus dem **Backend-Container** erreichbar sein, nicht nur
  vom Host (eigener DNS, eigener Zertifikatsspeicher). Bei lokaler CA siehe
  `DEPLOYMENT.md`, Abschnitt A2/2a.
- Das WWS greift weiterhin **nicht** auf den Docker-Socket zu und führt keine
  Shell-Befehle aus; es löst ausschließlich den fest konfigurierten
  Portainer-Webhook aus. Portainer bleibt der Verwalter des Stacks.
- Lässt sich die Build-Version weder automatisch noch per ENV feststellen, wird
  ein Update nach dem Neustart bewusst nicht als erfolgreich gemeldet.
- Ein Redeploy **außerhalb** des WWS (z. B. „Pull and redeploy" in Portainer)
  aktualisiert `APP_GIT_COMMIT` nicht: Die Versionsanzeige bleibt dann auf dem
  vorherigen Commit stehen, bis wieder aus dem WWS heraus aktualisiert wird.

## [v1.0.0] - 2026-05-03

### Enthalten
- Hardware-Warenwirtschaft mit FastAPI-Backend und React/Vite-Frontend
- Inventarverwaltung inkl. Kategorien und Statusmodellen
- Einsatzplanung mit Verfügbarkeitslogik und Übergabe-Verbund
- Check-in/Check-out sowie Defekt-/Wartungsprozesse
- Backup-/Restore-Funktionen
- GitHub Actions für tag-basierte GitHub Releases

### Hinweis
- Zukünftige Versionen werden als weitere Einträge ergänzt.
