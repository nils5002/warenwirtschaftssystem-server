# STATUS_LIFECYCLE.md

Stand: 2026-05-11
Geltungsbereich: Statuslogik für Assets, Wartung, Fremdbestand und ihre Auswirkungen auf Planung und Ausgabe.
Quellen: PROJECT_CONTEXT.md, AGENTS.md, `docs/MASTER_AUDIT.md`, Codebase (Stand siehe Audit).

Diese Datei ist reine Doku. Sie ändert keinen Code, keine Schemata, keine Tests. Sie ist die verbindliche Referenz für „welcher Statuswechsel ist erlaubt, wer darf ihn auslösen und was passiert dabei".

---

## 1. Zweck der Datei

Der Asset-Status ist im Warehouse-System der **fachliche Anker**, an dem fast alles hängt:

- **Inventar** zeigt anhand des Status, was real verfügbar ist.
- **Einsatzplanung** rechnet Bestand und Engpässe gegen den Status.
- **Ausgabe/Rücknahme** ändert den Status und erzeugt damit Activity-Einträge und Verriegelungen.
- **Defekte/Wartung** sperren das Gerät über Statusänderungen, automatisch synchronisiert.
- **Fremdbestand** ergänzt den Status um zeitfenster-basierte Verfügbarkeit.
- **QR-Code** identifiziert das Gerät statusunabhängig und muss konstant bleiben.

Ein falscher Statuswechsel kann doppelte Ausgaben, falsch geplante Engpässe oder „verschwundene" Geräte verursachen. Deshalb gilt: Statuslogik nie ohne diese Doku ändern, und nie ohne expliziten Test absichern.

Die Statuslogik des Systems ist absichtlich **klein und fachlich** — nicht ERP-vollständig. Ziel ist Praxistauglichkeit im Lager, nicht generische Asset-Management-Theorie.

---

## 2. Kanonische Asset-Status

Es existieren **genau vier** fachliche Statuswerte. Alle anderen Werte sind ausschließlich technische Normalisierungseingänge und keine fachlichen Zielzustände.

| Status | Bedeutung | Wer setzt ihn? |
|---|---|---|
| **Verfügbar** (`Verfuegbar`) | Gerät ist einsatzbereit und kann ausgegeben oder geplant werden. | Default beim Anlegen; Rückgabe; Wartung „Erledigt" wenn nichts mehr offen ist. |
| **Verliehen** | Gerät ist aktuell an Person + Projekt ausgegeben. | Ausgabe (Check-out). |
| **Defekt** | Gerät ist als defekt gemeldet, aber noch nicht in aktiver Reparatur. | Defektmeldung; Wartung „Offen". |
| **In Wartung** | Gerät ist in aktiver Bearbeitung durch Technik. | Wartung „In Bearbeitung". |

### Legacy-/Synonym-Werte (rein technisch)

Folgende Werte können historisch in DB-Importen, Backups oder Excel-Daten auftauchen und werden im Backend per Normalisierung (`_normalize_asset_status`) auf die kanonischen vier Werte gemappt. Sie sind **keine fachlichen Zielstatus**, dürfen nicht in UI-Labels neu eingeführt werden und sollen nicht von neuen Code-Pfaden gesetzt werden:

| Eingang (Legacy/Synonym) | Mapping |
|---|---|
| `Verfügbar` (mit Umlaut), `frei`, `available`, `einsatzbereit`, `ok` | → `Verfuegbar` |
| `Reserviert`, `Ausgegeben`, `Unterwegs`, `entliehen`, `in use`, `checked out` | → `Verliehen` |
| `wartung`, `service` | → `In Wartung` |
| `Verloren`, `defekt`, `kaputt` | → `Defekt` |

**Regel:** Diese Werte sind ausschließlich für die Toleranz beim Einlesen relevant. Im laufenden System schreibt der Code immer einen der vier kanonischen Werte zurück.

---

## 3. Grundregel Verfügbarkeit

Ein Gerät zählt nur dann als **fachlich verfügbar**, wenn alle folgenden Bedingungen erfüllt sind:

1. Asset-Status ist `Verfuegbar`.
2. Es existiert kein aktiver Defekt- oder Wartungseintrag, der dieses Gerät betrifft.
3. Bei Fremdbestand (`ownership_type` ∈ {`rented`, `borrowed`, `external`}):
   - das aktuelle bzw. das geprüfte Datum liegt innerhalb `available_from` … `available_until` (falls gesetzt),
   - `returned_at` ist nicht gesetzt bzw. liegt nach dem geprüften Datum.
4. Eigenbestand (`ownership_type` = `owned` oder leer) ist datum-unabhängig verfügbar, sofern 1 und 2 erfüllt sind.

Diese Regel gilt überall im System: in Inventarlisten, in der Planungs-Availability, im Overview-Endpoint und bei der Asset-Suche für Ausgabe.

Sie ist die Wahrheit. Wer eine neue Verfügbarkeitsabfrage einbaut, muss sich an dieselben vier Punkte halten und darf keine eigene Variante davon erfinden.

---

## 4. Statusübergänge als Tabelle

Für jeden Übergang sind Auslöser, Von-/Nach-Status, erlaubte Rollen, Nebenwirkungen, Activity-Log-Status und fachliche Hinweise dokumentiert.

| # | Übergang | Auslöser | Von | Nach | Erlaubte Rollen | Nebenwirkungen | Activity-Log | Fachliche Hinweise |
|---|---|---|---|---|---|---|---|---|
| 1 | **Gerät anlegen (Eigenbestand)** | Admin/Techniker legt Asset über Inventar an | — | `Verfuegbar` | Admin/Techniker | QR-Code wird automatisch erzeugt, falls nicht mitgegeben (`WMS\|<id>\|<tag>`). Kategorie wird normalisiert. | Kein expliziter Activity-Eintrag fürs Anlegen. | Kategorie muss aus der kanonischen Liste kommen — sonst landet das Gerät auf `Zuordnung erforderlich`. |
| 2 | **Fremdbestand anlegen (Charge)** | Admin oder Projektmanager legt Charge über External-Pool an | — | `Verfuegbar` | Admin/Techniker, Projektmanager | `ownership_type` ≠ `owned`, optional `available_from`/`available_until`/`return_due_date`, optional `source_name`. QR-Code wie bei Eigenbestand. | Kein Activity-Eintrag. | Geräte zählen nur im definierten Fenster als verfügbar. Außerhalb des Fensters tauchen sie im Planungsbestand nicht auf. |
| 3 | **Ausgabe (Check-out)** | Mitarbeiter scannt Gerät und bestätigt | `Verfuegbar` | `Verliehen` | Admin/Techniker, Mitarbeiter | `assigned_to`, `last_checkout` werden gesetzt; bei Batch-Scan pro Eintrag separat. | Ja — `upsert_asset` erzeugt einen Activity-Eintrag mit Operator-Label, Empfänger, Projekt. | Mitarbeiter/PM dürfen nur den reinen Statuswechsel `Verfuegbar`↔`Verliehen` machen, keine Stammdaten ändern (`_movement_only_allowed`). |
| 4 | **Rücknahme (Check-in)** | Mitarbeiter scannt verliehenes Gerät | `Verliehen` | `Verfuegbar` | Admin/Techniker, Mitarbeiter | `assigned_to` zurückgesetzt; `last_checkout` bleibt als Historie. | Ja — Activity-Eintrag „Check-in gebucht" mit Operator-Label. | Rücknahme darf nicht greifen, wenn Gerät tatsächlich `Defekt` oder `In Wartung` ist — Wartungs-Sync bestimmt dann den Status. |
| 5 | **Defekt melden** | Beliebige Rolle meldet Defekt im Tickets-Board | beliebig (typisch `Verfuegbar` oder `Verliehen`) | `Defekt` | Admin/Techniker, Projektmanager, Mitarbeiter | `_sync_asset_maintenance_status` setzt Asset auf `Defekt` und schreibt `maintenance_state = "Defekt gemeldet"`. | **Lücke** — die Defektmeldung erzeugt heute keinen Activity-Eintrag am Asset. | Defektmeldung sperrt das Gerät sofort, unabhängig vom vorherigen Status. Verliehen-Geräte werden nicht automatisch „zurückgenommen", aber für neue Ausgaben gesperrt. |
| 6 | **Wartung starten / In Bearbeitung setzen** | Admin/Techniker setzt Maintenance-Eintrag auf `In Bearbeitung` (auch `In Arbeit`, `Wartet auf Teile`) | `Defekt` | `In Wartung` | Admin/Techniker | `_sync_asset_maintenance_status` setzt Asset auf `In Wartung` und schreibt `maintenance_state = "Reparatur in Bearbeitung"`. | **Lücke** — kein Asset-Activity-Eintrag. | Der Eintrag bleibt im aktiven Board sichtbar. |
| 7 | **Wartung abschließen / Erledigt setzen — kein weiterer aktiver Eintrag** | Admin/Techniker setzt Maintenance auf `Erledigt` | `Defekt` oder `In Wartung` | `Verfuegbar` | Admin/Techniker | `_sync_asset_maintenance_status` prüft alle anderen Maintenance-Sätze, die zu diesem Asset passen (Name-Match + optional Tag-Substring). Wenn keiner mehr aktiv ist, wird der Asset-Status auf `Verfuegbar` zurückgesetzt und `maintenance_state = "Wartung erledigt"` geschrieben. | **Lücke** — kein Asset-Activity-Eintrag. | Erledigte Sätze verschwinden aus dem aktiven Board. Das Asset ist wieder fachlich verfügbar. |
| 8 | **Weiteren Defekt offen lassen** | Admin/Techniker setzt einen Wartungssatz auf `Erledigt`, aber ein anderer Defekt für dieses Gerät existiert weiterhin | `Defekt` oder `In Wartung` | bleibt `Defekt` oder `In Wartung` | Admin/Techniker | `_sync_asset_maintenance_status` erkennt restliche aktive Sätze und setzt den Asset-Status passend (`In Wartung`, wenn mindestens ein aktiver In-Bearbeitung-Eintrag existiert; sonst `Defekt`). | **Lücke** — kein Asset-Activity-Eintrag. | Das Gerät darf nicht freigegeben werden, solange ein anderer Defekt offen ist. Diese Regel ist mit Test `test_maintenance_locks_asset_…` abgesichert. |
| 9 | **Fremdbestand zurückgeben (Mark Returned)** | Admin oder PM markiert Mietgerät als zurückgegeben über `POST /api/wms/assets/{id}/mark-returned` | beliebig (außer `Verliehen`) | bleibt — Status wird nicht geändert | Admin/Techniker, Projektmanager | `returned_at` wird auf heute (oder explizit übergebenes Datum) gesetzt. Asset verschwindet aus der zukünftigen Verfügbarkeitsrechnung. | **Lücke** — kein Activity-Eintrag. | Mietgerät darf nicht als zurückgegeben markiert werden, solange es noch `Verliehen` ist — der Workflow verlangt erst regulären Check-in. Eigenbestand kann hierüber nicht markiert werden (HTTP 400). |
| 10 | **Fremdbestand löschen** | Admin oder PM löscht Mietgerät über `DELETE /api/wms/assets/{id}` | beliebig (außer `Verliehen`) | gelöscht | Admin/Techniker (alles), Projektmanager (nur Fremdbestand) | Asset wird hart entfernt. | Kein Activity-Eintrag — der Datensatz ist weg. | Wenn das Gerät aktuell `Verliehen` ist, gibt der Endpoint 409. Mitarbeiter dürfen nicht löschen. |
| 11 | **QR-Code erzeugen / erhalten** | Beim Asset-Save | — | unverändert | Admin/Techniker | `qr_code` wird einmalig auf `WMS\|<external_id>\|<tag_number>` gesetzt, falls Client keinen Wert mitschickt. Existiert bereits einer, wird er unverändert übernommen. | Kein Activity-Eintrag. | QR-Code darf sich nie durch Statuswechsel ändern (siehe Abschnitt 8). |
| 12 | **Massendruck / QR-Funktionen** | Admin nutzt MassPrint/QR-Page | — | unverändert | Admin/Techniker | Liest nur, schreibt nichts. | — | Keine fachliche Statusänderung. |

**Hinweis zur Tabelle:** Wo „Lücke" steht, ist das Verhalten *fachlich gewünscht*, aber das Activity-Log fehlt aktuell. Siehe Abschnitt 9.

---

## 5. Defekt- und Wartungsregeln

Diese Regeln sind verbindlich und in `_sync_asset_maintenance_status` (Backend) umgesetzt. Die Wartungsverriegelung ist der mit am sorgfältigsten getestete Teil des Systems und darf nicht ohne Test-Netz angefasst werden.

1. **Defektmeldung sperrt das Gerät sofort.**
   - Maintenance-Eintrag mit Status `Offen` → Asset-Status `Defekt`, `maintenance_state = "Defekt gemeldet"`.
2. **„In Bearbeitung" setzt Asset auf In Wartung.**
   - Synonyme `In Arbeit`, `Wartet auf Teile` zählen auch als aktiv.
   - Asset-Status `In Wartung`, `maintenance_state = "Reparatur in Bearbeitung"`.
3. **„Erledigt" gibt das Gerät nur dann frei, wenn kein weiterer aktiver Eintrag existiert.**
   - „Aktiv" = Status in {`Offen`, `In Bearbeitung`, `In Arbeit`, `Wartet auf Teile`}.
   - Wenn andere aktive Sätze existieren und mindestens einer in einem „In Bearbeitung"-Status ist → Asset bleibt `In Wartung`.
   - Wenn andere aktive Sätze existieren, alle nur `Offen` → Asset bleibt `Defekt`.
   - Wenn keiner mehr aktiv ist → Asset auf `Verfuegbar`, `maintenance_state = "Wartung erledigt"`.
4. **Erledigte Fälle verschwinden aus dem aktiven Ticket-Board.**
   - Das Board zeigt nur `Offen` und `In Bearbeitung`. `Erledigt` ist Abschluss, kein Spalten-Status.
5. **Aktive Defekt-/Wartungseinträge blockieren Planung und Verfügbarkeit.**
   - In allen Verfügbarkeitsabfragen (Inventar, Planung, Overview, Ausgabe-Validierung) gilt: Gerät mit `Defekt` oder `In Wartung` zählt nicht als verfügbarer Bestand.
6. **Mitarbeiter dürfen Defekt melden.**
   - Mitarbeiter darf Maintenance-Eintrag mit `Offen` erzeugen. Server-Guard: Status wird auf `Offen` begrenzt, andere Werte werden ignoriert/abgelehnt.
7. **Asset-Match basiert auf `asset_name`** (plus optionalem Substring-Match auf `tag_number`).
   - Beim Umbenennen eines Assets kann der Match versagen — Vorsicht bei Stammdaten-Änderungen während aktiver Defekte.

---

## 6. Fremdbestand-Regeln

1. **Eigenbestand (`ownership_type` = `owned` oder leer) ist datum-unabhängig verfügbar**, sofern Asset-Status `Verfuegbar` ist und keine aktive Wartung läuft.
2. **Fremdbestand ist nur im Verfügbarkeitsfenster nutzbar.**
   - `available_from` (falls gesetzt) ≤ aktuelles bzw. geprüftes Datum.
   - aktuelles bzw. geprüftes Datum ≤ `available_until` (falls gesetzt).
   - `returned_at` ist nicht gesetzt oder liegt nach dem geprüften Datum.
3. **Verliehener Fremdbestand darf nicht als zurückgegeben markiert werden.**
   - `POST /api/wms/assets/{id}/mark-returned` verweigert mit 400, solange Asset-Status `Verliehen` ist. Der Workflow verlangt erst regulären Check-in, dann „Mark Returned".
4. **Fremdbestand-Rückgabe ist nicht dasselbe wie Check-in.**
   - **Check-in (Rücknahme)** = Gerät kommt vom Einsatz zurück ins Lager, Status `Verliehen` → `Verfuegbar`, `returned_at` bleibt unberührt.
   - **Mark Returned** = Mietgerät wird endgültig an den Vermieter zurückgegeben, `returned_at` wird gesetzt, das Gerät verschwindet aus zukünftiger Verfügbarkeit. Asset-Status bleibt formal `Verfuegbar`, ist aber fachlich nicht mehr verfügbar.
5. **Fremdbestand löschen** erlaubt für Admin und Projektmanager, blockiert bei `Verliehen`.
6. **Fremdbestand entlastet die Planung nur im Fenster.**
   - Bestandszählung für eine Planung mit Zeitraum X..Y nimmt nur diejenigen Fremdbestand-Geräte mit, die für den jeweiligen Tag verfügbar sind. Ein Mietgerät, das nur 3 Tage da ist, hilft Planung X nur für diese 3 Tage.
7. **Eigentumsart kann nicht über Standard-Ausgabe gewechselt werden.**
   - `ownership_type` ist Stammdatum, nicht Status. Wechsel nur über Admin-Edit oder External-Pool-Anlage.

---

## 7. Planungsauswirkung

1. **Verfügbare Geräte reduzieren sich durch aktive Planungen** im Zeitraum.
   - „Aktive Planung" = Status in {`Entwurf`, `Geplant`, `Bestaetigt`, `Bestätigt`}. Stornierte und abgeschlossene zählen nicht.
2. **Ausgegebene Geräte (`Verliehen`) zählen nicht als verfügbarer Bestand.**
3. **`Defekt` und `In Wartung` zählen nicht als verfügbarer Bestand.**
4. **Fremdbestand zählt nur im Verfügbarkeitsfenster und ohne `returned_at`.**
5. **Handover-Verrechnung** entschärft Engpässe, ersetzt aber keine echte Verfügbarkeit.
   - Wenn Planung B mit Handover-Verbindung zu Planung A einen Engpass hat, wird die Tagesmenge von A am Vortag als Quelle gewertet (`handover_covered_qty`).
   - Verrechnung verringert `shortage_after_handover_qty`. Ist sie 0, gilt der Engpass als gelöst.
   - Engpässe mit aktivem Handover werden als gelb („review needed") statt rot dargestellt.
6. **Konflikt-Zählung** erfolgt pro `(Planung, Tag, Kategorie)`-Zelle mit `shortage_after_handover_qty > 0`.
   - Hinweis: Diese Zählweise ist fachlich tragend, aber für Endnutzer manchmal inflationär. Eine spätere Aggregation pro Kategorie-Cluster ist im Audit (P-Liste) vorgemerkt — bis dahin gilt die Zellen-Zählung.
7. **`missingItems` pro Planung** ist die zusätzliche kompakte Darstellung in der Planungsliste. Sie nimmt pro Kategorie den **maximalen** Tages-Fehlstand der Planung.

---

## 8. QR-Code-Regel

1. **QR-Code ändert sich nie durch einen Statuswechsel.**
   - Weder Ausgabe, Rücknahme, Defektmeldung, Wartung noch Mark-Returned dürfen den Wert von `qr_code` neu schreiben.
2. **QR-Code wird einmalig beim ersten Save erzeugt**, falls der Client keinen mitschickt: `WMS|<external_id>|<tag_number>`.
3. **QR-Code muss über Backup/Restore stabil bleiben.**
   - Backup-Export schreibt `qrCode` mit; Backup-Import übernimmt den Wert unverändert. Wenn ein Restore den QR-Code verlieren würde, wären die gedruckten Etiketten im Lager wertlos.
4. **Kategorie, Status, Projektzuordnung, Standort oder Eigentumsart erzeugen niemals einen neuen QR-Code.**
   - Diese Felder sind orthogonal zur Identität des Geräts.
5. **Tag-Number-Wechsel** ist organisatorisch möglich, sollte aber vermieden werden, weil der QR-Code-Inhalt das Tag-Feld enthält. Eine spätere Trennung von Identität und Tag-Number ist denkbar, aber kein aktuelles Ziel.
6. **QR-Scan-Auflösung** im Frontend (`resolveAssetByScan`) ist tolerant: sie findet Geräte über QR-Code, Tag-Number und Serial-Number. Das hilft, wenn ein Etikett unleserlich wird.

---

## 9. Bekannte offene Lücken

Diese Punkte sind im aktuellen System fachlich gewünscht, aber technisch noch nicht vollständig abgesichert. Sie stammen aus `docs/MASTER_AUDIT.md` und sollen hier nicht doppelt priorisiert werden — sie sind nur als Risiken sichtbar gemacht.

1. **Activity-Log fehlt bei Wartungs- und Fremdbestand-Statuswechseln.**
   - `_sync_asset_maintenance_status` und `mark_asset_returned` schreiben keinen Activity-Eintrag am Asset. Auditspur dort lückenhaft.
2. **Kombination Mietgerät + Defekt + Verliehen ist nicht explizit getestet.**
   - Was passiert, wenn ein verliehenes Mietgerät während des Einsatzes defekt wird, dann zurückkommt und dann das Mietfenster endet? Verhalten fachlich definiert (siehe Tabelle + Fremdbestand-Regeln), aber kein dedizierter Regressionstest.
3. **Statusübergänge sind als Tabelle hier verbindlich, aber nicht als zentrale Test-Matrix abgesichert.**
   - Audit P2.1 sieht einen Lifecycle-Matrix-Test vor; bis dahin gilt diese Datei als Referenz, nicht der Test.
4. **Datumsfelder sind teilweise Strings** (`reported_at`, `due_date`, `last_checkout`, `next_return`, `timestamp_text`).
   - Erschwert saubere Sortierung und Reports. Statuslogik selbst ist nicht betroffen, aber Anzeige/Filterung schon.
5. **Asset-Match in `_sync_asset_maintenance_status` basiert auf Namen + optionalem Tag-Substring.**
   - Beim Umbenennen eines Assets während eines aktiven Defekts kann der Match versagen.
6. **Polling-Race** (15 s): theoretisch kann ein Status-Refresh lokale, gerade gescannte Werte überschreiben. In der Praxis selten beobachtet, strukturell offen.
7. **Konflikt-Inflation in der Anzeige** (Zellen-Zählung statt Cluster) ist eine fachliche Stilentscheidung — keine Status-Lücke, aber im Audit als P4-Item vermerkt.

---

## 10. Nicht-Ziele

Diese Punkte sind ausdrücklich **nicht** Ziel dieser Doku und nicht Ziel zukünftiger Statuslogik-Änderungen ohne expliziten Auftrag:

1. **Keine neuen Status einführen.**
   - Insbesondere keine Zwischenstufen wie „Reserviert", „Ausgegeben", „Unterwegs", „Vorgemerkt", „Bereit zur Abholung" oder Ähnliches. Die vier kanonischen Werte sind absichtlich klein.
2. **Keine komplexe ERP-Statusmaschine.**
   - Keine Workflow-Engine, keine konfigurierbaren Status-Übergangsgraphen, keine deklarativen Statusregeln in YAML. Der Code ist die Wahrheit, diese Doku ist die Erläuterung.
3. **Keine UI-Änderung** anlässlich dieser Doku.
   - Keine neuen Buttons, keine neuen Status-Badges, keine neuen Filter.
4. **Keine Codeänderung** anlässlich dieser Doku.
   - Wenn beim Lesen Inkonsistenzen auffallen, sind sie als Audit-Items zu erfassen, nicht im selben Schritt zu „fixen".
5. **Keine Migration** anlässlich dieser Doku.
   - Auch wenn String-Datumsfelder unschön sind: Typisierung passiert nur als bewusster Auftrag mit Test-Netz, nicht „nebenbei".
6. **Keine Umbenennung der Status-Strings.**
   - `Verfuegbar` (ohne Umlaut) bleibt der Kanon. Eine Umbenennung auf `Verfügbar` würde Backups, Importe und SQL-Filter brechen.
7. **Keine Trennung von Identität und Tag-Number** in dieser Iteration.
   - Auch wenn fachlich denkbar, ist das ein separates Vorhaben.

---

## Zusammenfassung

- **Erstellt:** `docs/STATUS_LIFECYCLE.md` (diese Datei). Kein anderes File wurde verändert.
- **Keine Codeänderungen.** Kein Backend-, Frontend-, Test-, Migration-, Schema-, Docker-, ENV- oder Secret-Touch.
- **Sinnvolle nächste Dokumentationsdatei** (entsprechend der Empfehlungs-Reihenfolge in `docs/MASTER_AUDIT.md`):
  `docs/MIGRATIONS.md` — Entscheidungsregel: wann Alembic, wann `_ensure_new_columns` in `database/session.py`, wann `on_startup`-Patch in `main.py`. Damit die drei aktuell parallelen Migrationsquellen nicht auseinanderdriften und neue Entwickler eine klare Regel haben, wo ein Schema-Wechsel hingehört.
