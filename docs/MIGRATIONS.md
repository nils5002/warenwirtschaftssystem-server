# MIGRATIONS.md

Stand: 2026-05-11
Geltungsbereich: jede Änderung am DB-Schema dieses Projekts (SQLite/SQLAlchemy + Alembic).
Quellen: PROJECT_CONTEXT.md, AGENTS.md, `docs/MASTER_AUDIT.md`, `docs/STATUS_LIFECYCLE.md`, Codebase (Stand siehe Audit).

Diese Datei ist reine Doku. Sie ändert keinen Code, keine Schemata und keinen Betrieb. Sie ist die verbindliche Entscheidungsgrundlage dafür, **wo** ein Schemawechsel hingehört: Alembic, `_ensure_new_columns`, oder `on_startup`-Patch.

---

## 1. Zweck der Datei

Migrationen sind in diesem System **kritisch**, weil sie nicht isoliert wirken:

- **Datenbestand:** Die SQLite-Datei liegt im Docker-Volume `warehouse_app_data:/app/data`. Ein falscher `ALTER TABLE` kann die Datei korrumpieren, ohne dass es sofort auffällt.
- **Backup/Restore:** Jedes neue Feld muss durch den Export-/Import-Pfad (`backup_service.export_backup` / `import_backup`) reisen. Wer ein Feld nur in `AssetRecord` ergänzt und Backup vergisst, verliert das Feld beim nächsten Restore.
- **QR-Code-Stabilität:** QR-Codes sind im Lager auf Etiketten gedruckt. Eine Migration darf den Wert in `assets.qr_code` nicht neu erzeugen — sonst sind die Etiketten ungültig (siehe `docs/STATUS_LIFECYCLE.md` §8).
- **Produktionsbetrieb:** Es gibt **kein** automatisches Deployment-CI/CD. Ein Server-Restart zieht jede Form von „idempotenten Patches" beim Boot durch. Wer Patches einbaut, die unter Last lange laufen oder fehlschlagen, blockiert den Start der App.
- **Initial-Admin / Lockout-Schutz:** `ensure_initial_admin` und `clear_data_for_import` schützen die App vor einem Zustand ohne aktiven Admin. Eine Migration darf diesen Anker nicht aushebeln.
- **Drei aktuell parallele Quellen** (Alembic, `_ensure_new_columns`, `on_startup`) bedeuten: derselbe Schemawechsel kann an drei Orten unterschiedlich aussehen. Ohne klare Regel driften sie auseinander.

Deshalb: **keine schnellen unkontrollierten Schemaänderungen**. Jede Migration ist eine Produktentscheidung, kein Cleanup nebenbei.

---

## 2. Aktuelle Migrationsquellen

Diese fünf Pfade existieren heute parallel und greifen alle in das Schema oder die Daten ein. Sie sind im Audit dokumentiert (`docs/MASTER_AUDIT.md` §6, „Drei parallele Migrationsquellen").

### 2.1 Alembic-Migrationen
- Verzeichnis: `backend/alembic/versions/`.
- Aktuell vorhandene Versionen:
  - `20260417_0001_initial_wms_schema.py`
  - `20260417_0002_hardware_import_columns_and_logs.py`
  - `20260418_0003_user_profile_fields_and_normalization.py`
  - `20260418_0004_planning_module_foundation.py`
  - `20260418_0005_user_password_hash.py`
- Konfiguration: `backend/alembic.ini`, Umgebung: `backend/alembic/env.py`.
- Wird **nicht** automatisch beim Container-Start ausgeführt — Auslösung ist manuell oder per Runbook.

### 2.2 `database/session.py:_ensure_new_columns`
- Liste `_NEW_COLUMNS` mit `(table, column, sql_definition)`.
- Heute u. a. die Fremdbestand-Felder am AssetRecord (`ownership_type`, `source_name`, `available_from`, `available_until`, `return_due_date`, `returned_at`, `external_note`).
- Wird über `init_db()` (siehe `database/session.py`) bei Bedarf ausgeführt: prüft pro Spalte via `PRAGMA table_info`, fügt fehlende per `ALTER TABLE ADD COLUMN` hinzu.
- Zweck: **defensiver Kompatibilitätsschutz** für Produktivdatenbanken, die noch nicht per Alembic migriert sind.
- Parallel dazu: `_ensure_hot_path_indexes` (`CREATE INDEX IF NOT EXISTS …`).

### 2.3 `main.py:on_startup` Schema-Patches
- In `app/main.py:on_startup` werden punktuelle `ALTER TABLE ADD COLUMN`-Patches ausgeführt, derzeit u. a.:
  - `users.password_hash`, `users.is_active`,
  - `planning_items.handover_enabled`, `planning_items.linked_planning_external_id`, `planning_items.handover_note`.
- Zusätzlich: Standardkategorien-Seeding, optionaler Legacy-JSON-Seed, Initial-Admin-Sicherung, Passwort-Hash-Hardening.
- Läuft bei **jedem** App-Start.
- Zweck: **idempotenter Production-Sicherheitsanker** für Daten und minimale Schema-Drift-Reparatur.

### 2.4 SQLAlchemy `Base.metadata.create_all` / `DB_AUTO_CREATE_SCHEMA`
- In `database/session.py:init_db` wird `Base.metadata.create_all(bind=engine)` aufgerufen.
- Standardmäßig aktiviert über `Settings.db_auto_create_schema = True`.
- Legt fehlende **Tabellen** an (nicht: fehlende Spalten in existierenden Tabellen — das macht `_ensure_new_columns`).
- Zweck: Erstinitialisierung leerer DBs und Dev-Komfort.

### 2.5 Backup/Restore als zusätzlicher Datenpfad
- `backup_service.export_backup` → JSON mit allen Feldern.
- `backup_service.import_backup` → liest Backup-JSON, normalisiert Statuswerte, schreibt Records mit Defaults.
- Backup/Restore ist **keine** Schemamigration, aber jede Schemaänderung **muss** durch diesen Pfad mit:
  - alte Backups ohne neues Feld müssen weiterhin importierbar bleiben (Default),
  - neue Backups mit neuem Feld müssen die Daten erhalten,
  - QR-Code, Fremdbestand-Felder, Handover-Links bleiben stabil.

---

## 3. Grundregel

**Keine Schemaänderung ohne fachliche Begründung.** Jede neue Spalte, Tabelle oder Typänderung muss vor dem ersten Commit folgende Punkte explizit benannt haben:

1. **Zweck.** Welches fachliche Problem löst die Änderung? Wer profitiert?
2. **Betroffene Daten.** Welche Records, welche Mengen, welche bestehenden Werte sind betroffen?
3. **Auswirkung auf Backup/Restore.** Muss der Export erweitert werden? Können alte Backups noch importiert werden?
4. **Auswirkung auf Tests.** Welche existierenden Tests müssen angepasst werden, welche neuen kommen dazu?
5. **Auswirkung auf bestehende Produktionsdaten.** Was passiert mit Bestandsdaten, die das neue Feld noch nicht haben? Welche Defaults greifen?
6. **Rollback-Überlegung.** Wie reagiert man, wenn die Änderung in Produktion nicht funktioniert? Manuell, per Restore, per Alembic-Downgrade?

Wenn auch nur einer dieser Punkte unklar ist: **nicht migrieren**, sondern erst die Doku ausfüllen und mit dem Fach abstimmen.

---

## 4. Entscheidungsregel: Wann Alembic?

**Alembic ist die Hauptquelle für jede dauerhafte strukturelle Änderung.**

Alembic ist der richtige Ort für:

- **neue Tabellen** (z. B. eine zukünftige `activities_v2`),
- **neue Spalten** (additiv, mit Default),
- **neue Indizes** (auch wenn `_ensure_hot_path_indexes` ihn parallel kennt — Alembic ist die Wahrheitsquelle),
- **Constraints** (Unique, Check),
- **Foreign Keys** (auch ON-Delete-Regeln),
- **Typänderungen** (siehe §10 — hier ganz besonders),
- **Datenmigrationen** (Backfill, Normalisierung bestehender Werte),
- **Umbenennungen** (Tabelle, Spalte, Constraint),
- **Löschungen** (Spalte, Tabelle — nur mit Lockout-/Backup-Prüfung).

Pflichtteile einer Alembic-Migration in diesem Projekt:

- Eindeutiger Revision-Identifier nach bestehendem Schema (`YYYYMMDD_NNNN_kurzbeschreibung.py`).
- `upgrade()` mit additiver Logik **und** `downgrade()` mit Reverse-Logik (auch wenn SQLite Downgrade limitiert).
- Defaults für jede neue Spalte, damit `ALTER TABLE ADD COLUMN` bei vorhandenen Zeilen nicht scheitert.
- Erläuternder Modul-Docstring: Zweck, Datenmenge, Rollback-Hinweis.
- Bei Datenmigration: idempotent schreiben (zweimaliges Ausführen darf nicht doppeln).

**Regel:** Wenn ein neues Feld dauerhaft im Schema leben soll, wird **immer** auch eine Alembic-Migration angelegt — auch wenn aus Hot-Deploy-Gründen parallel `_ensure_new_columns` greift.

---

## 5. Entscheidungsregel: Wann `_ensure_new_columns`?

`_ensure_new_columns` ist **nur** ein defensiver Hot-Deploy- und Kompatibilitätsschutz. Es ist nicht der Hauptweg für Schemaänderungen.

Erlaubt sind:

- **additive, ungefährliche Spalten** mit klarem Default,
- Spalten, deren Alembic-Migration in Produktion noch nicht ausgeführt wurde, aber das Feature ist bereits live,
- `CREATE INDEX IF NOT EXISTS` über `_ensure_hot_path_indexes`.

Nicht erlaubt sind:

- **Typänderungen** an existierenden Spalten (z. B. String → Date),
- **Löschungen** von Spalten,
- **komplexe Constraints** (Unique über mehrere Spalten, Check-Constraints — die gehen via Alembic),
- **Datenmigrationen** (Backfill, Normalisierung) — gehört nicht hierher,
- **Foreign Keys** auf bestehende Spalten umzuschalten,
- **Umbenennungen** von Spalten.

**Pflichtsatz beim Ergänzen von `_ensure_new_columns`:**
Es muss parallel eine Alembic-Migration existieren oder eine schriftliche Begründung im PR/Commit stehen, warum nicht. Andernfalls driftet das Schema zwischen Dev/Test (per Alembic) und Production (per Hot-Patch).

`_ensure_new_columns` ist eine **Brücke**, nicht das Haus.

---

## 6. Entscheidungsregel: Wann `main.py` Startup-Patch?

Startup-Patches in `app/main.py:on_startup` sind **Ausnahmefälle**, keine Routine. Sie laufen bei jedem App-Start und blockieren den Boot.

Erlaubt sind:

- **idempotente Schutzmaßnahmen** (z. B. eine Spalte, die kritisch fehlen darf nicht — schnelles `ADD COLUMN IF MISSING`),
- **Initial-Seed** (Standardkategorien, Default-Konfigwerte),
- **Admin-Lockout-Schutz** (`ensure_initial_admin`, `ensure_user_passwords` für Legacy-User),
- **minimaler Production-Sicherheitsanker** für Felder, die für die Boot-Pfade benötigt werden, bevor Alembic je gelaufen ist.

Nicht erlaubt sind:

- **normale Feature-Migrationen** (gehört zu Alembic),
- **größere Schemaänderungen** mit Datenmenge,
- **versteckte Datenkorrekturen** (würden Daten still verändern, ohne dass jemand davon weiß),
- **komplexe Business-Migrationen** (mehrstufige Backfills, Statusumzüge).

**Regel:** Ein neuer Startup-Patch braucht in der Code-Review explizit eine Begründung, warum das nicht in Alembic oder `_ensure_new_columns` geht. Default-Antwort sollte „passt nicht hier rein" sein.

---

## 7. Entscheidungsregel: Wann `create_all` / `DB_AUTO_CREATE_SCHEMA`?

`Base.metadata.create_all(bind=engine)` ist nur für **Erstinitialisierung leerer Datenbanken und Dev-Setups** geeignet. Es ist kein Ersatz für Migrationen.

Es gilt ausdrücklich:

- **`create_all` ändert keine bestehenden Spaltentypen zuverlässig.** Wenn eine Spalte schon existiert, lässt `create_all` sie unverändert, auch wenn das ORM-Modell einen anderen Typ deklariert.
- **`create_all` entfernt keine alten Spalten.** Eine entfernte ORM-Spalte bleibt physisch in der DB.
- **`create_all` ersetzt Alembic nicht.** Es legt nur fehlende Tabellen an, kein Detail-Diff.
- **`create_all` legt keine fehlenden Spalten in existierenden Tabellen an.** Das macht heute `_ensure_new_columns`.

`DB_AUTO_CREATE_SCHEMA=true` ist der heutige Default und für lokale Entwicklung sowie für die Erst-Inbetriebnahme einer leeren Production-DB sinnvoll. In einer reifen Production-Welt würde man `false` setzen und Alembic alleinige Wahrheitsquelle sein lassen — aber das ist explizit ein Audit-P4-Item (`docs/MASTER_AUDIT.md` §9, P4.4) und kein aktuelles Ziel.

---

## 8. Backup/Restore-Auswirkung

Jede Schemaänderung muss bewusst durch den Backup-Pfad geführt werden, **bevor** sie als „fertig" gilt. Diese Checks sind verbindlich:

1. **Export enthält das neue Feld?**
   - `backup_service.export_backup` muss das Feld im JSON ausgeben (Asset-Block, Planning-Block etc.).
2. **Import kann altes Backup ohne Feld lesen?**
   - Das Pydantic-Schema (`schemas/backup.py`) muss einen Default haben oder das Feld als `Optional` markieren. Alte Backups dürfen nicht 400 werfen.
3. **Import kann neues Backup mit Feld lesen?**
   - Das Mapping `payload → ORM-Record` (in `backup_service.import_backup`) muss das neue Feld setzen.
4. **Default-Werte sind sinnvoll?**
   - Bool: explizit `False` oder `True` nach Fachregel, nicht ungesetzt.
   - String: leer oder `"-"` (passend zum bestehenden Muster).
   - Date: `None` ist okay, wenn das Feld optional ist.
   - Ownership: `"owned"` ist Default (siehe Fremdbestand-Felder).
5. **QR-Code bleibt stabil?**
   - Backup-Restore darf `qr_code` nicht regenerieren. Wenn ein Backup `qrCode` mitliefert, übernehmen — keine `_build_qr_code`-Logik im Import-Pfad starten.
6. **IDs bleiben stabil?**
   - `external_id` wird aus dem Backup übernommen. Sie ist die fachliche Identität — Foreign Keys, Activity-Verweise, Handover-Links hängen daran.
7. **Admin bleibt erhalten?**
   - `clear_data_for_import` und der Restore-Pfad müssen weiterhin mindestens einen aktiven Admin garantieren (siehe `docs/STATUS_LIFECYCLE.md` und `MASTER_AUDIT.md`).
8. **Fremdbestand-/Handover-Felder bleiben vollständig?**
   - `ownership_type`, `source_name`, `available_from`, `available_until`, `return_due_date`, `returned_at`, `external_note` — alle im Export und Import.
   - `handover_enabled`, `linked_planning_external_id`, `handover_note` an `PlanningItemRecord` — ebenfalls in beide Pfade.

Wenn auch nur eine Antwort „weiß ich nicht" ist: nicht mergen. Erst klären.

---

## 9. Sichere Vorgehensweise bei neuen Feldern

Empfohlener Ablauf für jede additive Schemaänderung. Reihenfolge ist wichtig:

1. **Fachlichen Zweck prüfen.**
   - Steht es im Einklang mit PROJECT_CONTEXT.md und der Statuslogik aus `docs/STATUS_LIFECYCLE.md`?
   - Gibt es eine Alternative ohne Schemaänderung (z. B. abgeleiteter Wert)?

2. **Pydantic-Schema prüfen / erweitern.**
   - `schemas/wms.py` bzw. das passende Modul.
   - Default-Wert oder `Optional`, damit alte Clients/Backups kompatibel bleiben.

3. **SQLAlchemy-Modell erweitern.**
   - `database/models.py`.
   - Nullable + Default überlegen.
   - Index nur, wenn klar Hot-Path.

4. **Alembic-Migration erstellen.**
   - Neue Revision in `backend/alembic/versions/`.
   - `upgrade()` mit `op.add_column(...)` o. ä., `downgrade()` mit Reverse.
   - Modul-Docstring mit Zweck und Rollback-Hinweis.

5. **Backup/Restore erweitern.**
   - `backup_service.export_backup`: Feld im JSON-Block.
   - `backup_service.import_backup`: Mapping in den Record.
   - Pydantic-Backup-Schema in `schemas/backup.py` ergänzen.

6. **Frontend-Typen / API prüfen.**
   - `frontend/src/services/wmsApi.ts`: Type-Definitionen ergänzen.
   - Optional in der UI verwenden — nicht Pflicht für den ersten Schritt.

7. **Tests ergänzen.**
   - Mindestens: ein Test, der den neuen Wert über Pydantic/REST-Roundtrip prüft.
   - Bei fachlicher Bedeutung: Verfügbarkeits-/Statuslogik-Test ergänzen.
   - Backup-Roundtrip-Test, wenn das Feld persistiert wird.

8. **Lokalen Restore testen.**
   - Export → Wipe → Import → Vergleich.
   - Test sowohl mit altem Backup (ohne Feld) als auch mit neuem Backup (mit Feld).

9. **Erst danach committen.**
   - Commit-Message-Muster: `feat(<modul>): add <feldname> with alembic + backup`.
   - Wenn die Reihenfolge unterbrochen wurde: keinen Teil-Stand mergen.

`_ensure_new_columns` darf, falls Production gerade nicht migriert werden kann, **zusätzlich** in derselben PR ergänzt werden — niemals als Ersatz für Schritt 4.

---

## 10. Typänderungen

Typänderungen sind die **kritischste Klasse** von Migrationen. Sie sind nicht additiv, sondern transformativ. Beispiele aus diesem Projekt:

- **String-Datum → `Date` / `DateTime`** (`reported_at`, `due_date`, `last_checkout`, `next_return`, `timestamp_text`).
- **Status-String → Enum** (z. B. AssetRecord.status, MaintenanceRecord.status).
- **Freitext `assigned_to` → strukturierte Relation** (`assigned_user_id` + Projekt-Referenz).
- **Tag-Number-Trennung von Identität** (zukünftig, falls überhaupt).

Für jede Typänderung ist erforderlich:

1. **Datenkonvertierung.**
   - Wie werden bestehende Werte umgesetzt?
   - Beispiel String-Datum: Format erkennen, parsen, in `Date` speichern, unparsebare Werte loggen und z. B. auf `NULL` legen.
   - Strategie: schrittweise (alte Spalte bleibt zuerst, neue Spalte parallel, Backfill, dann Cutover).

2. **Backup-Kompatibilität.**
   - Backup, das vor der Typänderung erstellt wurde, muss nach der Änderung importierbar bleiben.
   - Backup, das nach der Typänderung erstellt wurde, muss in einem Restore mit alter Codebasis nicht zwingend funktionieren — aber das ist im Runbook zu dokumentieren.

3. **Regressionstests.**
   - Vor der Änderung: Tests, die das alte Verhalten festhalten.
   - Nach der Änderung: Tests, die das neue Verhalten festhalten.
   - Ohne dieses Test-Netz wird die Änderung nicht gemerged.

4. **Rollback-Plan.**
   - Wie kommt man zurück, wenn die Änderung in Production scheitert?
   - Alembic-Downgrade reicht bei SQLite oft nicht (kein Spalten-Drop ohne Tabelle-Neuanlage).
   - Pragmatisch: Restore aus Backup. Backup also vorher manuell erstellen.

5. **Keine gleichzeitigen UI-Großumbauten.**
   - Eine Typänderung am Datenfeld und ein Refactoring der zugehörigen Page in derselben PR ist verboten.
   - Erst Schema-Cutover ausrollen, stabilisieren, dann UI-Verbesserungen separat.

Zusätzlich gilt:

- **Cutover in Production** läuft nie still: vorher Backup, vorher Maintenance-Window kommunizieren, vorher Doku-Update in `docs/MIGRATIONS.md`.
- **Keine Typänderungen in `_ensure_new_columns` oder `on_startup`.** Sie gehören ausschließlich nach Alembic.

---

## 11. Nicht-Ziele

Diese Punkte sind **nicht** das Ziel dieser Doku — und damit auch nicht das Ziel zukünftiger Codex-Aufgaben, solange kein expliziter separater Auftrag vorliegt:

1. **Kein sofortiger Umbau der bestehenden Migrationstechnik.**
   - Die drei Quellen bleiben vorerst parallel, kontrolliert durch diese Doku.
2. **Kein Entfernen von `_ensure_new_columns`.**
   - Es ist der Hot-Deploy-Schutz für Production, in der Alembic noch nicht alleinige Wahrheitsquelle ist.
3. **Kein Entfernen von Startup-Patches in `main.py`.**
   - Sie schützen Boot, Initial-Admin und Standardkategorien.
4. **Kein Alembic-Refactor in diesem Schritt.**
   - Versionsverkettung und Stil bleiben wie sie sind.
5. **Keine automatische Produktionsmigration.**
   - Es wird nicht automatisch `alembic upgrade head` beim Container-Start eingeführt. Wer das tun will, braucht eigenen Auftrag, Runbook, Rollback-Plan.
6. **Keine Codeänderung anlässlich dieser Doku.**
   - Wenn beim Lesen Inkonsistenzen auffallen, sind sie als Audit-Items zu erfassen, nicht im selben Schritt zu „fixen".
7. **Keine neuen Schemaänderungen anlässlich dieser Doku.**
   - Die Doku ist Anleitung, kein Anlass.

---

## 12. Checkliste für zukünftige Codex-Aufgaben

Diese Checkliste ist **bindend** und vor jedem Commit, der das Schema oder die Backup-Form berührt, durchzugehen. Wenn nur eine Antwort „nein/unklar" ist, **nicht mergen**.

- [ ] Wird mit dieser Änderung das Datenbankschema verändert?
- [ ] Gibt es dafür eine **Alembic-Migration** in `backend/alembic/versions/`?
- [ ] Muss `_ensure_new_columns` in `database/session.py` zusätzlich ergänzt werden (Production-Hot-Deploy)?
- [ ] Muss der Backup-Pfad (`backup_service.export_backup` + `import_backup` + `schemas/backup.py`) angepasst werden?
- [ ] Sind **alte Backups** (ohne das neue Feld) noch ohne Fehler importierbar — durch Default oder Optional?
- [ ] Sind passende **Tests** ergänzt (mindestens Roundtrip, idealerweise fachliche Statuslogik)?
- [ ] Wurde garantiert **kein QR-Code** durch die Änderung neu generiert (siehe `docs/STATUS_LIFECYCLE.md` §8)?
- [ ] Wurde der **Admin-Lockout-Schutz** nicht ausgehebelt (Wipe-Pfad behält weiterhin mindestens einen aktiven Admin)?
- [ ] Wurde die Änderung **lokal** mit Export → Wipe → Import getestet?
- [ ] Gibt es einen klaren **Rollback-Plan** (Backup vorher, Downgrade-Strategie)?

Bei Typänderungen zusätzlich:

- [ ] Wurde die Datenkonvertierung (Backfill) idempotent und mit Fehlerbehandlung gestaltet?
- [ ] Gibt es Tests vor und nach der Änderung, die das Verhalten festhalten?
- [ ] Wurde sichergestellt, dass **kein UI-Großumbau** parallel im selben Commit / in derselben PR steckt?

---

## Zusammenfassung

- **Erstellt:** `docs/MIGRATIONS.md` (diese Datei). Kein anderes File wurde verändert.
- **Keine Codeänderungen.** Kein Backend-, Frontend-, Schema-, Test-, Docker-, ENV-, Cloudflare- oder Secret-Touch. Keine neue Alembic-Datei. Keine Migration ausgeführt.
- **Sinnvolle nächste Dokumentationsdatei** (entsprechend `docs/MASTER_AUDIT.md` §G):
  `docs/BACKUP_RUNBOOK.md` — Schritt für Schritt: Export, Wipe (mit Admin-Erhalt!), Import, Wiederanlauf, was zu prüfen ist. Inklusive der SQLite-„4-Slashes"-Warnung aus `.env.example` und `docker-compose.yml`, damit Production beim nächsten Restore nicht in das Pfad-Loch fällt.
