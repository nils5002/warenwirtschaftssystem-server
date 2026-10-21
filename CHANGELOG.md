# Changelog

Alle relevanten Änderungen an diesem Projekt werden hier dokumentiert.

## [Unreleased]

### Hinzugefügt
- **Warehouse Companion App** (installierbare PWA für iPhone/Android):
  Smartphone am PC unter *Mein Konto → Companion App* per QR-Code koppeln
  (120 s, einmalig, Bestätigung am PC mit Abgleichcode), danach ohne
  Passworteingabe arbeiten — mit denselben Funktionen und Rechten wie am PC.
  Jedes Gerät ist einzeln und sofort widerrufbar; Companion ist pro Konto
  standardmäßig aus. Entsperren per Passkey (WebAuthn, Face ID/Fingerabdruck/
  Geräte-PIN je nach Gerät) mit echter serverseitiger Sperrwirkung — beim
  Öffnen der App, nach mehr als einer Minute im Hintergrund und spätestens
  nach 30 Minuten Inaktivität; Face ID startet auf dem Sperrbildschirm
  automatisch. Ohne Passkey weist die App auf die fehlende Sperre hin.
  Neue Seite *Mein Konto*, öffentliche Seite
  `/verbinden`, Manifest, Icons und ein Service Worker, der bewusst weder
  App-Hülle noch API-Daten cacht.
- Mobile Oberfläche: untere Navigation *Start · Planung · Inventar · Scannen ·
  Mehr* (alle weiteren, rollenabhängigen Bereiche im *Mehr*-Panel); behoben:
  Viewport-Blowout der Inventar-Karten bei langen Gerätenamen und der
  QR-Funktionen-Eingabezeile; größere Touch-Flächen (≥ 44 px) in Benutzer-,
  Update-Notizen- und Fremdbestand-Ansicht.
- Neue Abhängigkeiten: `webauthn` (Backend), `@simplewebauthn/browser`
  (Frontend). Alembic-Revision `20260422_0008`.
- **SMTP-Verwaltung im Adminbereich** (`Administration → E-Mail-Einstellungen`):
  Statuskarte, SMTP-Konfiguration, Verbindungstest, echte Test-E-Mail und die
  Auswahl des Registrierungsverfahrens — alles in der Anwendung, ohne
  Portainer-Zugriff. Die dort gespeicherten Werte liegen in der Datenbank im
  persistenten Volume und überleben jeden Redeploy.
- **Zwei ausdrücklich getrennte Registrierungsverfahren.**
  `classic_admin_approval` (**Standard**): Registrierung → *Wartet auf
  Freigabe* → Admin gibt frei → Login. Funktioniert **vollständig ohne jede
  SMTP-Konfiguration**. `email_verification`: zusätzlich E-Mail-Bestätigung vor
  der Admin-Freigabe. Die Umstellung ist immer eine bewusste Adminentscheidung
  und erst möglich, wenn SMTP konfiguriert, aktiviert, erfolgreich getestet und
  eine Test-E-Mail angenommen wurde. Der Rückweg auf das klassische Verfahren
  ist **immer** erlaubt.
- Neue Admin-Endpunkte `GET/PUT /api/admin/email/settings`,
  `GET /api/admin/email/status`, `POST /api/admin/email/test-connection`,
  `POST /api/admin/email/send-test`, `PUT /api/admin/email/registration-mode`
  (Rolle **und** neues Recht `mail.manage`, rate-limitiert, auditiert).
- Verschlüsselte Secret-Ablage (`app/services/secret_store.py`, Fernet): Das
  über die Oberfläche gepflegte SMTP-Passwort steht ausschließlich als
  Chiffretext in der Datenbank und verlässt den Server nie — weder im Klartext
  noch als Chiffretext. Der Schlüssel wird per HKDF-SHA256 (eigener
  Kontext-String) aus `AUTH_TOKEN_SECRET` abgeleitet — **kein zusätzlicher
  ENV-Eintrag nötig**. Optional hat ein eigener `MAIL_CONFIG_ENCRYPTION_KEY`
  Vorrang; mit beiden Schlüsseln gespeicherte Passwörter bleiben lesbar. Neue
  Dependency `cryptography`.
- Öffentliche WWS-Adresse für Bestätigungslinks im Adminbereich pflegbar
  (validiert, in Produktion nur HTTPS, nie aus dem Host-Header; Fallback
  `FRONTEND_URL`). Spalte `mail_settings.public_base_url`, Teil des Backups.
- Adminseite in fünf Bereiche gegliedert: Status, SMTP-Einstellungen (inkl.
  Test-E-Mail an frei wählbare Adresse), Registrierungsverfahren,
  Bestätigungslinks, Diagnose (Ursprung, Schlüsselquelle, letzte Tests und
  Fehler).
- E-Mail-Verwaltung **nur für Admins**: Rolle *und* Recht werden serverseitig
  geprüft (ein im Rolleneditor vergebenes `mail.manage` genügt nicht), der
  Menüpunkt ist für andere Rollen ausgeblendet. Schreibende Endpunkte verlangen
  bei Cookie-Sitzungen zusätzlich `X-Requested-With: XMLHttpRequest`
  (CSRF-Schutz) und sind rate-limitiert (Tests und Konfigurationsänderungen).
- Eindeutige Konfigurationspriorität: aktivierte Adminkonfiguration →
  `SMTP_*`-Umgebungsvariablen → deaktiviert. Die aktive Quelle ist im
  Adminbereich sichtbar; eine kaputte Adminkonfiguration fällt bewusst **nicht**
  still auf die Umgebungsvariablen zurück.
- Neue Tabelle `mail_settings` (Alembic-Revision `20260421_0007`) und
  Systemeinstellung `registration_mode`; beide Teil des Backups.
- Backup-Import meldet jetzt ausdrücklich `warnings` — unter anderem, wenn ein
  älteres Backup keine E-Mail-Verifizierungsangaben enthielt oder ein
  verschlüsseltes SMTP-Passwort nur mit passendem Masterkey nutzbar ist.
- **E-Mail-Bestätigung nach der Registrierung.** Eine Selbst-Registrierung legt
  das Konto weiterhin inaktiv an und verschickt zusätzlich einen zeitlich
  begrenzten Bestätigungslink. Anmelden kann sich ein Konto erst, wenn die
  **E-Mail bestätigt UND die Admin-Freigabe erteilt** ist — die bestehende
  Freigabe wird dadurch nicht umgangen. Es werden **keine Passwörter per E-Mail**
  versendet.
- Neue Endpunkte `POST /api/auth/verify-email` und
  `POST /api/auth/resend-verification` (beide rate-limitiert, beide antworten
  ohne Account-Enumeration) sowie die Admin-Aktion
  `POST /api/wms/users/{id}/resend-verification` (nur Rolle Admin, Recht
  `users.manage`).
- Schlanker SMTP-Mailservice (`app/services/email_service.py`) mit geprüftem
  TLS (`starttls`/`ssl`); unverschlüsselter Versand ist außerhalb der
  Entwicklung blockiert. Versandfehler werden kontrolliert behandelt und nie
  als Erfolg dargestellt — die Registrierungsantwort meldet `emailSent: false`
  samt Hinweis, das Konto bleibt bestehen und der Link kann erneut angefordert
  werden. Zugangsdaten, Tokens und Bestätigungs-URLs tauchen in keinem Log auf.
- Professionelle HTML-Mail mit Text-Alternative (Tabellen-Layout, Inline-Styles,
  keine externen Ressourcen → mobil- und clientkompatibel, kein Referrer-Leck).
- Frontend: Bestätigungsansicht „Registrierung eingegangen" mit „E-Mail erneut
  senden" auf der Login-Seite sowie die öffentliche Seite
  `/registrierung-bestaetigen` (Erfolg, abgelaufener Link, ungültiger Link,
  erneuter Versand). Der Token wird per POST eingelöst und sofort aus der
  Adresszeile entfernt.
- Benutzerverwaltung zeigt den Bestätigungsstand als eigenen Chip
  („E-Mail nicht bestätigt" / „E-Mail bestätigt") **neben** dem Freigabe-Status,
  sodass sich beide Zustände nicht gegenseitig überschreiben; Admins können eine
  neue Bestätigungs-E-Mail anfordern.
- Neue Umgebungsvariablen: `SMTP_ENABLED` (Default **aus**), `SMTP_HOST`,
  `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`,
  `SMTP_FROM_NAME`, `SMTP_SECURITY`, `EMAIL_VERIFICATION_EXPIRY_HOURS`.
  `FRONTEND_URL` wird jetzt auch vom Backend gelesen — der Bestätigungslink
  entsteht ausschließlich daraus (nie aus einem Request-Header) und muss in
  Produktion HTTPS sein.
- Neue Tabelle `email_verification_tokens` (nur SHA-256-Hash, Ablauf,
  Einmal-Verwendung) und die Benutzerspalten `email_verification_required` /
  `email_verified_at`; Alembic-Revision `20260420_0006`.

### Geändert
- Ein Logout der Mobile-API (`/api/mobile/auth/logout`) hat bisher auch alle
  Browser-Sitzungen desselben Benutzers beendet; Desktop- und Geräte-Logout
  sind jetzt getrennt (Sicherheitsereignisse beenden weiterhin alles).
- Der Profil-Button in der Kopfleiste öffnet jetzt *Mein Konto* (bisher
  Benutzerverwaltung bzw. Dashboard).
- `POST /api/auth/register` arbeitet nach dem aktiven Verfahren und liefert
  `verificationRequired` mit. Im klassischen Verfahren wird keine E-Mail
  versendet und kein Mail-Hinweis angezeigt.
- Benutzerverwaltung unterscheidet jetzt drei Bestätigungszustände:
  *nicht erforderlich* (klassisch registriert, Bestands- und Adminkonten),
  *E-Mail nicht bestätigt* und *E-Mail bestätigt* — jeweils unabhängig vom
  Freigabe-Status.
- Honeypot, Registrierungs-Rate-Limit und der Admin-Schalter für die
  Registrierung bleiben unverändert in Kraft.

### Kompatibilität
- **Das Deployment funktioniert mit `SMTP_ENABLED=false` vollständig.** Ohne
  jede E-Mail-Konfiguration läuft die Registrierung im klassischen Verfahren
  weiter; der Startup-Log weist das als Normalzustand aus (keine Warnung).
- `MAIL_CONFIG_ENCRYPTION_KEY` ist **optional**. Ohne ihn wird der Schlüssel
  aus `AUTH_TOKEN_SECRET` abgeleitet. Nur wenn auch das kein brauchbares Secret
  ist (Platzhalter), wird das Speichern eines SMTP-Passworts kontrolliert
  abgelehnt (HTTP 409 mit Begründung) statt im Klartext zu speichern.
- Nach einer Rotation von `AUTH_TOKEN_SECRET` ist ein gespeichertes
  SMTP-Passwort nicht mehr lesbar; das wird im Adminbereich angezeigt und das
  Passwort ist einmal neu einzugeben (kein stiller Versand mit leerem Passwort).
- **Bestehende Benutzer bleiben unverändert nutzbar.** Die Bestätigungspflicht
  trägt ausschließlich, wer sich nach diesem Update selbst registriert
  (`email_verification_required`, Default 0). Bestandskonten, vom Admin
  angelegte Benutzer und Konten aus alten Backups werden vom Login-Gate nie
  geprüft. Rollen und Rechte sind unberührt.
- Backup/Restore: Der Bestätigungsstatus wird mit gesichert; alte Backups ohne
  die Felder bleiben importierbar. Einmal-Tokens wandern bewusst nicht ins
  Backup.

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
