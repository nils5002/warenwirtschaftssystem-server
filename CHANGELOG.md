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

### Hinweise
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
