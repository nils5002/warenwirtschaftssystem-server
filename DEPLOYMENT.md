# DEPLOYMENT

## A) Portainer Deployment

1. In Portainer neuen Stack aus Git-Repository anlegen.
2. `docker-compose.yml` als Compose-Datei waehlen.
3. ENV-Werte setzen.
4. Deploy starten.

Empfohlene Basiswerte:

```dotenv
APP_NAME=Warehouse-System
APP_ENV=production
BASE_URL=https://warehouse.example.com
FRONTEND_URL=https://warehouse.example.com
CORS_ORIGINS=https://warehouse.example.com,http://localhost:5173,http://127.0.0.1:5173
VITE_API_URL=/api
VITE_API_BASE=
VITE_PROXY_TARGET=http://backend:8000
FRONTEND_PORT=8080
BACKEND_PORT=8001
```

## A1) Registrierung, E-Mail-Versand und SMTP-Verwaltung

### Zwei Registrierungsverfahren — Standard ist das klassische

| Verfahren | Schluesselwert | Ablauf | SMTP noetig? |
|---|---|---|---|
| **Klassisch (Standard)** | `classic_admin_approval` | Benutzer registriert sich → Status *Wartet auf Freigabe* → Admin gibt frei → Login | **nein** |
| Mit E-Mail-Bestaetigung | `email_verification` | Benutzer registriert sich → bestaetigt seine Adresse → Admin gibt frei → Login | ja |

**Nach einem frischen Deploy gilt immer das klassische Verfahren.** Es
funktioniert ohne jede SMTP-Konfiguration vollstaendig — genau so laesst sich
das WWS produktiv betreiben, bevor E-Mail eingerichtet ist. Die Umstellung auf
das zweite Verfahren ist **immer** eine bewusste Adminentscheidung; sie
passiert nie automatisch, auch nicht nach einem erfolgreichen SMTP-Test.

Faellt SMTP spaeter aus, bleibt der klassische Weg jederzeit waehlbar.
Bestehende Konten werden dabei **nicht** stillschweigend herabgestuft: Wer sich
mit Bestaetigungspflicht registriert hat, muss sie auch nach einem Wechsel
zurueck erfuellen — der Link laesst sich nachtraeglich erneut anfordern,
sobald SMTP wieder laeuft.

Der bestehende Schalter "Selbstregistrierung offen/gesperrt"
(*Sicherheit & Protokolle*) bleibt davon vollstaendig unabhaengig.

### SMTP in der Anwendung einrichten (empfohlener Weg)

`Administration → E-Mail-Einstellungen`:

1. SMTP-Server, Port, Verschluesselung, Zugangsdaten und Absender eintragen,
   *SMTP-Versand aktivieren* ankreuzen, **Einstellungen speichern**.
2. **Verbindung testen** — prueft Erreichbarkeit und Anmeldung.
3. **Test-E-Mail senden** — an eine echte Adresse; danach das Postfach
   kontrollieren (eine Annahme durch den Server ist noch kein Zustellnachweis).
4. Erst wenn Schritt 2 und 3 erfolgreich waren, laesst sich unter
   *Registrierungsverfahren* die Option **E-Mail-Bestaetigung + Admin-Freigabe**
   waehlen.

Wird die Konfiguration spaeter geaendert, verfallen die Testergebnisse
bewusst — ein Test fuer Server A darf Server B nicht freischalten.

Die hier gespeicherten Werte liegen in der Datenbank im persistenten Volume und
ueberleben jeden Redeploy.

### Passwortablage — keine zusaetzliche Variable noetig

Das in der Oberflaeche eingegebene SMTP-Passwort wird **ausschliesslich
verschluesselt** gespeichert (Fernet: AES + HMAC). Den Schluessel leitet die App
automatisch per **HKDF-SHA256** aus dem ohnehin vorhandenen `AUTH_TOKEN_SECRET`
ab — mit eigenem Salt und Kontext-String, also ein separater Schluessel, der
nur fuer diesen Zweck taugt. Das Auth-Secret selbst wird nie als Schluessel
verwendet; kein Schluessel steht in der Datenbank, im Backup oder im Frontend.

**Fuer eine korrekt abgesicherte Installation ist damit kein neuer
Portainer-Eintrag noetig.** Voraussetzung: `AUTH_TOKEN_SECRET` ist ein eigener,
geheimer Wert (kein Platzhalter, mind. 16 Zeichen) — das erzwingt die App fuer
den Produktivstart ohnehin.

Optional (z. B. um das SMTP-Passwort unabhaengig vom Auth-Secret rotieren zu
koennen) kann weiterhin ein eigener Schluessel gesetzt werden; er hat dann
Vorrang:

```dotenv
MAIL_CONFIG_ENCRYPTION_KEY=<44 Zeichen, url-safe base64>
# erzeugen: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Bereits mit einem dieser Schluessel gespeicherte Passwoerter bleiben lesbar,
solange der jeweilige Schluessel vorhanden ist; die App verschluesselt nie
stillschweigend um. Welcher Schluessel aktiv ist, zeigt *Diagnose →
Passwort-Verschluesselung*.

> **Rotation von `AUTH_TOKEN_SECRET`** (bzw. Entfernen/Aendern von
> `MAIL_CONFIG_ENCRYPTION_KEY`): Danach ist ein damit gespeichertes
> SMTP-Passwort nicht mehr lesbar. Die App meldet das sichtbar ("Das
> gespeicherte SMTP-Passwort kann mit dem aktuellen Schluessel nicht
> entschluesselt werden … neu eingeben") und verschickt **nicht** still mit
> leerem Passwort. Neuvergabe: In *E-Mail-Einstellungen* das SMTP-Passwort
> einmal neu eingeben und speichern — es wird mit dem aktuellen Schluessel
> abgelegt. Gleiches gilt nach dem Restore eines Backups aus einer
> Installation mit anderem Secret (der Import weist darauf hin).
>
> Steht `AUTH_TOKEN_SECRET` auf einem Platzhalter und ist kein eigener Key
> gesetzt, wird das Speichern eines Passworts kontrolliert abgelehnt
> (HTTP 409); alles andere — insbesondere die klassische Registrierung — laeuft
> weiter.

### Oeffentliche WWS-Adresse fuer Bestaetigungslinks

Ebenfalls in *E-Mail-Einstellungen → Bestaetigungslinks* pflegbar (z. B.
`https://warehouse.example.de`). Ohne Eintrag gilt `FRONTEND_URL` aus der
Server-Umgebung. Die Adresse wird serverseitig geprueft (nur `http(s)://host`,
keine Zugangsdaten/Parameter; in Produktion nur `https://`) und **nie** aus
einem Request-Header uebernommen. Aenderungen wirken sofort, ohne Neustart.

### Alternative: SMTP komplett ueber Portainer-Variablen

```dotenv
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=warehouse@example.com
SMTP_PASSWORD=<nur hier, nie im Repo>
SMTP_FROM_EMAIL=noreply@example.com
SMTP_FROM_NAME=Warehouse-System
SMTP_SECURITY=starttls
EMAIL_VERIFICATION_EXPIRY_HOURS=24
```

### Konfigurationsprioritaet (eindeutig, keine Mischformen)

1. **Adminkonfiguration** aus der Oberflaeche — sofern aktiviert, vollstaendig
   und entschluesselbar.
2. Sonst die **SMTP_\*-Umgebungsvariablen**.
3. Sonst: **SMTP deaktiviert** (klassische Registrierung).

Welche Quelle gerade gilt, steht in der Statuskarte unter
*Aktive Konfiguration* ("WWS-Administration" oder "Server-Umgebungsvariablen").
Eine aktivierte, aber kaputte Adminkonfiguration faellt bewusst **nicht**
still auf die Variablen zurueck — sonst wuerde unbemerkt mit einem anderen
Absender verschickt.

`SMTP_SECURITY`:
- `starttls` — Standard, Port 587.
- `ssl` — implizites TLS, Port 465.
- `none` — **nur** fuer einen lokalen Test-Relay; ausserhalb von
  `APP_ENV=development/local/test` verweigert die App den Versand.

In beiden TLS-Varianten wird das Serverzertifikat inkl. Hostname geprueft
(`ssl.create_default_context()`), ein Downgrade findet nicht statt.

### Voraussetzung: oeffentliche Adresse

Der Bestaetigungslink wird **ausschliesslich** aus der in der Administration
hinterlegten oeffentlichen Adresse bzw. ersatzweise `FRONTEND_URL` gebaut (nie
aus einem Request-Header — sonst waere Host-Header-Injection moeglich). In
Produktion muss sie mit `https://` beginnen; andernfalls wird gar keine Mail
versendet und der Grund im Adminbereich angezeigt. Der Link zeigt auf
`<Adresse>/registrierung-bestaetigen?token=…`; die Einloesung selbst laeuft per
`POST /api/auth/verify-email`.

### Zugriff

Die E-Mail-Verwaltung (alle `/api/admin/email/*`-Endpunkte sowie der Versand
einer Bestaetigungsmail fuer andere Benutzer) ist **ausschliesslich der Rolle
Admin** vorbehalten — serverseitig geprueft (Rolle *und* Recht `mail.manage`;
ein im Rolleneditor vergebenes Recht allein genuegt nicht). Ohne Anmeldung:
401, andere Rollen: 403. Schreibende Aufrufe einer Browser-Sitzung muessen
zusaetzlich den Header `X-Requested-With: XMLHttpRequest` tragen
(CSRF-Schutz, das Frontend setzt ihn automatisch) und sind rate-limitiert.

### Pruefen, ob es laeuft

Im Backend-Log direkt nach dem Start stehen zwei Zeilen:

```
E-Mail-Versand einsatzbereit (Quelle: Administration|Umgebungsvariablen).
   bzw. Kein E-Mail-Versand konfiguriert (<Grund>). Registrierung laeuft im
        klassischen Verfahren mit Admin-Freigabe.
Registrierungsverfahren: classic_admin_approval|email_verification
```

Ein fehlender Versand wird nur dann als **Warnung** geloggt, wenn die
E-Mail-Bestaetigung aktiv ist — im klassischen Verfahren ist er der
dokumentierte Normalzustand.

Zugangsdaten tauchen in keinem Log auf — weder Benutzername noch Passwort,
weder Token noch Bestaetigungs-URL.

### Betriebshinweise

- Fehlgeschlagene Bestaetigungen lassen sich erneut anstossen: durch den
  Nutzer (`E-Mail erneut senden` auf der Login-/Bestaetigungsseite) oder durch
  einen Admin (Benutzerverwaltung → `Bestätigung senden`).
- Jeder neue Link entwertet den vorherigen sofort; ein Link gilt einmalig und
  laeuft nach der eingestellten Gueltigkeitsdauer ab.
- Alle Mailwege sind rate-limitiert (pro IP **und** pro Empfaengeradresse),
  damit kein Endpunkt als Mail-Bombe gegen ein fremdes Postfach dient; das
  gilt auch fuer die Test-E-Mail im Adminbereich.
- Aenderungen an SMTP-Einstellungen und am Registrierungsverfahren landen im
  Security-Log (*Sicherheit & Protokolle*) — ohne Zugangsdaten.
- Backup/Restore:
  - Der Bestaetigungsstatus der Benutzer wandert mit ins Backup, die
    Einmal-Tokens bewusst nicht.
  - Die SMTP-Konfiguration (inkl. oeffentlicher Adresse) wandert mit; das
    Passwort nur als Chiffretext. Lesbar ist es nach einem Restore nur mit
    demselben `AUTH_TOKEN_SECRET` bzw. `MAIL_CONFIG_ENCRYPTION_KEY` — der
    Import sagt ausdruecklich, ob das zutrifft (siehe "Passwortablage" oben).
  - Alte Backups ohne diese Felder bleiben importierbar. Der Import weist
    ausdruecklich darauf hin (`warnings` in der Antwort und im Log), wenn
    Benutzer ohne Verifizierungsangaben wiederhergestellt wurden — sie gelten
    dann als "Bestaetigung nicht erforderlich" und koennen sich nach der
    Admin-Freigabe wie bisher anmelden.
  - Enthaelt ein Backup keine SMTP-Sektion, bleibt eine vorhandene
    Konfiguration unangetastet (statt still geloescht zu werden).

## A1b) Warehouse Companion App (Smartphone)

Installierbare PWA derselben Anwendung — gleiche Datenbank, gleiche API,
gleiche Rollen und Rechte. **Keine neuen ENV-Variablen, keine App-Stores.**

### Voraussetzungen
- Die WWS-Domain laeuft ueber **HTTPS** (Passkeys und Installation verlangen
  das; `localhost` ist nur fuer Entwicklung ausgenommen).
- `FRONTEND_URL` (bzw. die oeffentliche WWS-Adresse in den E-Mail-
  Einstellungen) entspricht der Adresse, unter der Benutzer das WWS aufrufen —
  sie bestimmt, von welcher Herkunft Companion-Anfragen und Passkeys
  akzeptiert werden.
- Neue Tabellen (`companion_devices`, `companion_pairing_requests`,
  `companion_passkeys`) entstehen beim Start ueber `init_db`
  (`DB_AUTO_CREATE_SCHEMA=true`, Default) bzw. Alembic-Revision
  `20260422_0008`.

### Ablauf fuer Benutzer
1. Am PC: **Mein Konto → Companion App** aktivieren (standardmaessig aus).
2. **Neues Geraet verbinden** → QR-Code (120 s gueltig, einmalig).
3. QR-Code mit dem Smartphone scannen (Kamera oder Scanner in der
   installierten App). Am PC erscheint die Anfrage mit Geraet und
   Abgleichcode → **Verbinden**.
4. Auf dem Smartphone: **Zum Home-Bildschirm hinzufuegen** und
   **Passkey einrichten** (Entsperren per Face ID/Fingerabdruck/Geraete-PIN —
   die Methode bestimmt das Betriebssystem).
5. Geraete einzeln oder alle entfernen: ebenfalls unter Mein Konto.

**iOS-Hinweis:** Safari und die Home-Bildschirm-App haben getrennte Speicher.
Am zuverlaessigsten: erst installieren, dann in der App ueber
„QR-Code scannen" koppeln. Wurde in Safari gekoppelt, einmal in der App neu
verbinden.

### Sicherheitsmodell (Kurzfassung)
- Der QR-Code enthaelt nur einen kurzlebigen Einmal-Code im URL-Fragment
  (erscheint in keinem Server-/Proxy-Log). Eine Sitzung entsteht erst nach
  Bestaetigung durch den angemeldeten PC-Benutzer; Kopplungen koennen nur
  vom PC (nicht von einem Handy) gestartet und bestaetigt werden.
- Jedes Geraet hat eine eigene Sitzung: Secret (256 Bit) im HttpOnly-Cookie
  `wms_device` (`SameSite=Strict`, nur `/api/companion`), in der DB nur als
  Hash, rotiert bei jeder Erneuerung; Wiederverwendung eines alten Secrets
  sperrt das Geraet. Access-Tokens der Geraete leben 15 Minuten; jede
  Anfrage prueft die Geraetezeile — **ein Widerruf wirkt sofort**.
- Desktop- und Handy-Logout melden sich nicht gegenseitig ab. Passwort-Reset,
  Rollenwechsel, Deaktivierung/Sperre, „Sitzungen widerrufen" (Admin) und
  „Companion deaktivieren" beenden alle Geraete des Kontos.
- Mit Passkey wird das Geraet nach 30 Minuten Inaktivitaet gesperrt — das
  Backend lehnt dann jede Anfrage dieses Geraets ab, bis eine serverseitig
  gepruefte Passkey-Bestaetigung (User Verification) vorliegt. Pruefung durch
  die Bibliothek `webauthn` (py_webauthn); Passkeys sind an genau ein Geraet
  gebunden.
- Ohne Passkey (z. B. Browser ohne WebAuthn) gibt es keinen Sperrbildschirm;
  das Geraet bleibt ueber den PC jederzeit widerrufbar.
- Backup/Restore: Geraetesitzungen, Kopplungen und Passkeys werden **nie**
  wiederhergestellt; nach einem Restore muessen Smartphones neu verbunden und
  Companion pro Konto neu aktiviert werden.

### Service Worker
`/sw.js` cacht bewusst **weder** die App-Huelle **noch** API-Daten — nur eine
Offline-Hinweisseite. Neue Deploys sind damit sofort aktiv; fremde/alte
Service Worker und Caches werden beim Start weiterhin entfernt. Fuer
`/sw.js` und `/manifest.webmanifest` sind keine besonderen Proxy-Regeln noetig.

## A2) Systemupdate aus dem WWS (Portainer-Webhook)

Ein Admin kann den Redeploy direkt im WWS starten
(`Administration → Systemupdate`). Das WWS verwaltet dabei **kein Docker**: Es
ruft ausschliesslich einen fest konfigurierten Portainer-Stack-Webhook auf.
Portainer zieht daraufhin selbst den aktuellen Git-Stand und baut den Stack neu.

### 1. Webhook in Portainer aktivieren

1. Portainer → Stacks → WWS-Stack → **Webhooks**.
2. `Enable webhook` einschalten (bzw. bereits vorhandene URL kopieren).
3. Die URL hat die Form
   `https://<portainer-host>/api/stacks/webhooks/<uuid>` und ist ein Geheimnis:
   Wer sie kennt, kann den Stack neu ausrollen.

### 2. Webhook in der Server-`.env` eintragen

Nur serverlokal (z. B. `/opt/web/cloud_web_runtime/.env`) — **niemals im
Repository**:

```dotenv
SYSTEM_UPDATE_ENABLED=true
PORTAINER_STACK_WEBHOOK_URL=https://portainer.example.com/api/stacks/webhooks/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
GITHUB_REPOSITORY=nils5002/warenwirtschaftssystem-server
GITHUB_BRANCH=main
SYSTEM_UPDATE_TIMEOUT_SECONDS=600
# optional (privates Repo / hoeheres API-Rate-Limit):
GITHUB_API_TOKEN=
```

In Portainer werden diese Werte unter *Stacks → WWS-Stack → Environment
variables* gesetzt; anschliessend einmal **Update the stack**, sonst greifen
sie nicht.

Fehlt `PORTAINER_STACK_WEBHOOK_URL` oder ist `SYSTEM_UPDATE_ENABLED=false`,
bleibt die Seite sichtbar, meldet aber lediglich „Systemupdates sind auf diesem
Server nicht aktiviert." Die uebrige Anwendung ist davon nicht betroffen.

### 2a. Die URL muss aus dem *Container* erreichbar sein

Haeufigste Stolperfalle: Die Webhook-URL funktioniert auf dem Host, aber nicht im
Backend-Container. Das WWS ruft sie aus dem Container heraus auf — dort gelten
andere DNS-Server und ein anderer Zertifikatsspeicher.

Pruefen (ohne einen Redeploy auszuloesen — `GET` statt `POST`, Portainer
antwortet mit `405`; die URL nie ausgeben, sie enthaelt das Token):

```sh
docker exec <backend> python -c "
import os, requests
print(requests.get(os.environ['PORTAINER_STACK_WEBHOOK_URL'], timeout=10).status_code)"
```

Typische Ursachen und was die Adminseite dazu meldet:

| Meldung | Ursache |
| --- | --- |
| „TLS-Zertifikat konnte nicht geprüft werden" | Portainer hinter einem Reverse Proxy mit lokaler/selbstsignierter CA |
| „Portainer ist nicht erreichbar" | Name loest im Container nicht auf, oder keine Route |
| „Portainer hat nicht rechtzeitig geantwortet" | Gegenstelle blockiert/haengt |

Bewaehrte Loesung fuer eine lokale CA: Portainer in **dasselbe Docker-Netz** wie
das Backend haengen und die interne Adresse verwenden — dann faellt TLS ganz
weg, der Aufruf verlaesst das Docker-Netz nicht:

```dotenv
PORTAINER_STACK_WEBHOOK_URL=http://portainer:9000/api/stacks/webhooks/<uuid>
```

Zwei Dinge sind dabei zu beachten:

* Das Netz muss in Portainers **eigener** Compose-Definition stehen
  (`external: true`). Ein `docker network connect` von Hand ueberlebt zwar einen
  Neustart, aber **nicht** das Neuerstellen des Portainer-Containers — also
  spaetestens das naechste Portainer-Update.
* Damit haengt Portainer an einem Netz, das dem WWS-Stack gehoert. Wird der
  Stack geloescht oder **umbenannt**, startet Portainer nicht mehr. Recovery:
  `docker network create <netzname>`, dann Portainer starten.

Die Alternative ohne gemeinsames Netz waere, die lokale Root-CA in den Container
zu mounten und `REQUESTS_CA_BUNDLE` darauf zu setzen. Dann aber ein **kombiniertes**
Bundle (oeffentliche Roots + eigene CA) verwenden: Die Variable ersetzt den
Trust-Store vollstaendig, mit der eigenen CA allein scheitert die
GitHub-Versionspruefung.

### 3. Build-Metadaten (woher das WWS seine Version kennt)

Die Anwendung muss wissen, welchen Commit sie ausfuehrt — sonst laesst sich nach
einem Redeploy nicht pruefen, ob wirklich die Zielversion laeuft. Die installierte
Version wird in dieser Reihenfolge bestimmt:

| Rang | Quelle | Greift bei |
| --- | --- | --- |
| 1 | `/app/build_info.json` (beim Build aus `.git` abgeleitet) | Build mit Git-Kontext: lokal, CI |
| 2 | bestaetigte Version in der Datenbank | nach einem Update aus dem WWS heraus (Portainer) |
| 3 | `APP_GIT_COMMIT` / `APP_GIT_BRANCH` | Deploy ganz ohne Git-Kontext (`git archive`) |

`APP_GIT_COMMIT` steht bewusst hinten: Eine von Hand gepflegte Variable veraltet
mit dem naechsten Redeploy, die beiden Quellen darueber sind an das laufende
Image gebunden. `.git` landet dabei nur in der Build-Stufe, **nicht** im
Laufzeit-Image.

**Wichtig fuer Portainer:** Portainer checkt Git-Stacks **ohne `.git`** aus
(geprueft mit 2.39.1 — in `/data/compose/<id>` liegt nur der Dateibaum). Rang 1
faellt dort also aus, das Image kennt seinen Commit nicht. Zwei Mechanismen
fangen das auf:

*Erstens* haengt das WWS die Zielversion beim Redeploy an den Webhook an:

```text
POST https://<portainer>/api/stacks/webhooks/<uuid>?APP_GIT_COMMIT=<sha>&APP_GIT_BRANCH=main
```

Bei klassischen Stack-Webhooks macht Portainer daraus Stack-Variablen, die
`docker-compose.yml` als Build-Args weiterreicht. **Am GitOps-Webhook eines
Git-Stacks passiert das nicht** (2.39.1 am Live-Stack geprueft: Redeploy und
Rebuild laufen, die Parameter werden ignoriert). Abschaltbar ueber
`SYSTEM_UPDATE_PASS_BUILD_METADATA=false`.

*Zweitens* — und das ist der Weg, der unter Portainer traegt — dient die
**Buildzeit als Beleg**: `build_info.json` enthaelt immer eine Buildzeit, auch
ohne `.git`. Das WWS merkt sie sich beim Ausloesen; laeuft nach dem Neustart ein
Image mit anderer Buildzeit, ist belegt, dass der Redeploy gegriffen hat. Der
Zielcommit wird dann als bestaetigte Version gespeichert (Rang 2) und gilt genau
so lange, wie ein Image mit dieser Buildzeit laeuft.

**Bekannte Grenze:** Wird der Stack **ausserhalb** des WWS neu gebaut (z. B.
„Pull and redeploy"), passt die gespeicherte Buildzeit nicht mehr und die
Version gilt als *unbekannt* — bewusst so, statt einen veralteten Commit zu
behaupten. Das naechste Update aus dem WWS heraus stellt sie wieder her. Wer
ueberwiegend manuell ausrollt, pflegt stattdessen `APP_GIT_COMMIT`.

Lokal/CI funktioniert beides:

```sh
docker compose build backend                                             # automatisch aus .git
docker compose build --build-arg APP_GIT_COMMIT=$(git rev-parse HEAD) backend   # explizit
```

Laesst sich die Version weder automatisch noch per ENV feststellen, funktioniert
das Update weiterhin — das WWS meldet den Vorgang danach aber bewusst **nicht**
als erfolgreich, sondern als „Version nach Neustart nicht ueberpruefbar". Es
wird nie faelschlich Erfolg gemeldet.

### 4. Ablauf und Backupverhalten

```text
Admin oeffnet Systemupdate
  -> WWS prueft den neuesten Commit auf GitHub
  -> WWS vergleicht installierte und verfuegbare Version
  -> Admin bestaetigt "Backup erstellen und Update installieren"
  -> WWS erstellt ein vollstaendiges Backup und validiert es
  -> WWS ruft den Portainer-Webhook GENAU EINMAL auf
  -> Portainer zieht den Git-Stand, baut und startet den Stack neu
  -> WWS erkennt nach dem Neustart die laufende Version
```

Das Backup entsteht **vor** dem Webhook-Aufruf und liegt als ZIP unter
`BACKUP_PATH` (Default `/app/data/backups`, also im persistenten Volume). Es
enthaelt `backup.json` mit dem kompletten Datenbestand (Assets, Kategorien,
Benutzer, Planungen, Wartungen, Systemeinstellungen, ...) sowie unter `files/`
die hochgeladenen Login-Hintergruende und den Produktbild-Cache. Standardmaessig
werden die letzten 10 Pre-Update-Backups aufbewahrt
(`SYSTEM_UPDATE_BACKUP_RETENTION`).

**Schlaegt das Backup fehl, wird kein Webhook ausgeloest und das Update
abgebrochen.**

### 5. Verhalten bei Fehlern

| Fall | Verhalten |
| --- | --- |
| GitHub nicht erreichbar | Versionspruefung meldet den Fehler; die App bleibt normal nutzbar |
| Backup fehlgeschlagen | Update wird abgebrochen, **kein** Redeploy, Vorgang als „Fehlgeschlagen" protokolliert |
| Portainer nicht erreichbar / lehnt ab | Kein Redeploy, Update-Lock wird sofort freigegeben |
| Backend kommt nicht zurueck | Nach `SYSTEM_UPDATE_TIMEOUT_SECONDS` gilt der Vorgang als „Zeitueberschreitung" |
| Nach Neustart laeuft ein anderer Commit | Vorgang wird als „Fehlgeschlagen" protokolliert — Stack in Portainer pruefen |

Wiederherstellung im Ernstfall: Das Pre-Update-Backup aus `BACKUP_PATH`
entpacken und `backup.json` ueber `Administration → Backup → Wiederherstellen`
einspielen.

### 5a. Am Live-Stack bestaetigtes Verhalten (Stand 2026-07-27)

Gegen Portainer 2.39.1 (Stack `warenwirtschaftssystem`, ID 11) geprueft:

| Beobachtung | Ergebnis |
| --- | --- |
| `.git` im Checkout `/data/compose/11` | **nicht vorhanden**, auch nach „Pull and redeploy" |
| `build_info.json` im dortigen Image | `commit: null` — Ableitung greift nur mit Git-Kontext |
| `APP_GIT_COMMIT` aus den Stack-Variablen | kommt als Build-Arg **und** zur Laufzeit im Container an |
| Versionsanzeige mit gesetzter Variable | korrekt, inkl. Buildzeit aus `build_info.json` |
| Query-Parameter am GitOps-Webhook | werden **ignoriert** — Redeploy und Rebuild laufen trotzdem |
| Buildzeit im Image nach dem Redeploy | aendert sich zuverlaessig (Beleg fuer die Erfolgspruefung) |

Ebenfalls geprueft: Die Webhook-URL muss aus dem Backend-Container erreichbar
sein — ueber den Reverse Proxy scheiterte sie an der lokalen CA. In Betrieb ist
deshalb die interne Adresse `http://portainer:9000/...`, wofuer Portainer im
Docker-Netz des Stacks haengt (deklarativ in Portainers eigener Compose-Datei,
sonst ueberlebt es kein Neuerstellen).

### 6. Vorher in einer Staging-Umgebung testen

Vor der ersten Nutzung produktiv einmal gegen einen Test-Stack pruefen:

1. Zweiten Portainer-Stack (Staging) aus demselben Repository anlegen.
2. Dessen Webhook-URL in der Staging-`.env` eintragen, `SYSTEM_UPDATE_ENABLED=true`.
3. Update im Staging-WWS ausloesen und pruefen: Backup vorhanden, genau ein
   Redeploy, Version nach dem Neustart korrekt erkannt, Historie plausibel.

## B) Domain wechseln

Fuer eine neue Domain nur diese ENV-Werte anpassen:
- `BASE_URL`
- `FRONTEND_URL`
- `CORS_ORIGINS`

Optional:
- `FRONTEND_PORT`
- `BACKEND_PORT`

Beispiel neue Domain:

```dotenv
BASE_URL=https://lager.firma.de
FRONTEND_URL=https://lager.firma.de
CORS_ORIGINS=https://lager.firma.de,http://localhost:5173,http://127.0.0.1:5173
```

## C) Reverse-Proxy-neutrales Beispiel

Beispiel mit beliebigem Reverse Proxy:
- Domain: `warehouse.example.com`
- Forward Host/IP: `SERVER-IP`
- Forward Port: `8080`
- Scheme: `http`
- SSL: Zertifikat im Reverse Proxy hinterlegen

Wichtig:
- Die App terminiert kein TLS.
- Intern nur HTTP:
  - Frontend Container-Port `4173`
  - Backend Container-Port `8000`

## D) Cloudflare optional (ohne Tunnel)

Cloudflare kann optional als DNS/Proxy genutzt werden.
Cloudflare Tunnel (`cloudflared`) ist nicht erforderlich.

Beispiel Cloudflare ohne Tunnel:
- DNS Record:
  - Type: `A`
  - Name: `warehouse`
  - IPv4: oeffentliche Server-IP
  - Proxy: optional `AN`
- Reverse Proxy auf dem Server leitet `warehouse.example.com` auf `http://127.0.0.1:8080`.

## API-Routing

Frontend nutzt standardmaessig relative API-URL:
- `VITE_API_URL=/api`
- `VITE_API_BASE=`

Dadurch funktioniert die App domain-neutral hinter jedem Reverse Proxy.

## SPA-Deep-Links (URL-Routing)

Die App nutzt URL-basiertes Routing mit tiefen Pfaden (z. B. `/inventar/<assetId>`,
`/einsatzplanung/<planningId>`). Damit Refresh und direkte Links funktionieren,
muss die Frontend-Auslieferung fuer alle Nicht-`/api`-Pfade die `index.html`
liefern (SPA-Fallback).

- Aktuelles Setup: Der Frontend-Container laeuft mit `vite preview`
  (`frontend/Dockerfile`) — dessen SPA-Fallback ist eingebaut, es ist
  **keine zusaetzliche Konfiguration noetig**.
- Falls die Auslieferung spaeter auf nginx/statisches Hosting umgestellt wird:
  SPA-Fallback konfigurieren (nginx: `try_files $uri /index.html;`),
  `/api` und `/media` weiterhin ans Backend proxien.
