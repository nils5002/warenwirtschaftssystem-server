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
  Damit stimmt die Versionsanzeige nach jedem Portainer-Redeploy ohne manuell
  gepflegte Stack-Variable. `.git` landet nicht im Laufzeit-Image.
- Neue Umgebungsvariablen: `SYSTEM_UPDATE_ENABLED` (Default **aus**),
  `PORTAINER_STACK_WEBHOOK_URL`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH`,
  `GITHUB_API_TOKEN`, `SYSTEM_UPDATE_TIMEOUT_SECONDS`. `APP_GIT_COMMIT`,
  `APP_GIT_BRANCH` und `APP_BUILD_TIME` sind nur noch eine Überschreibung für
  Builds ohne Git-Kontext.

### Hinweise
- Das WWS greift weiterhin **nicht** auf den Docker-Socket zu und führt keine
  Shell-Befehle aus; es löst ausschließlich den fest konfigurierten
  Portainer-Webhook aus. Portainer bleibt der Verwalter des Stacks.
- Lässt sich die Build-Version weder automatisch noch per ENV feststellen, wird
  ein Update nach dem Neustart bewusst nicht als erfolgreich gemeldet.

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
