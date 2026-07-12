# Specs.md – Warehouse-System / Hardware-Warenwirtschaft

## 1. Projektziel

Das Projekt ist eine praxisnahe Hardware-Warenwirtschaft für Akkreditierungsprojekte, Events und interne Hardwareverwaltung.

Die Anwendung soll keine komplexe ERP-Software sein, sondern ein schnelles, verständliches und robustes System für den realen Arbeitsalltag.

Ziel ist es, Hardware wie Laptops, iPads, Handhelds, QR-Code-Scanner, Drucker, Kartendrucker, Router, Switches und Zubehör sauber zu verwalten, projektbezogen zu planen, auszugeben, zurückzunehmen und über QR-Codes eindeutig nachzuverfolgen.

Die Software soll besonders folgende Abläufe unterstützen:

- Hardwarebestand verwalten
- neue Geräte erfassen
- Geräte per QR-Code identifizieren
- Geräte einem Projekt zuordnen
- Geräte einer Person oder einem Mitarbeiter zuordnen
- Hardwarebedarf für Projekte planen
- verfügbare Geräte gegen geplanten Bedarf prüfen
- Ausgabe und Rückgabe dokumentieren
- Defekte und Wartung erfassen
- Excel-Bestände importieren
- Daten exportieren

---

## 2. Grundidee des realen Ablaufs

Der reale Firmenprozess sieht ungefähr so aus:

1. Ein Kunde oder ein internes Team plant ein Projekt oder Event.
2. Ein Projektmanager legt fest, welche Hardware benötigt wird.
   Beispiel:
   - 5 Laptops
   - 3 Handhelds
   - 2 iPads
   - 1 Drucker
3. Diese Planung wird im System hinterlegt.
4. Mitarbeiter oder Juniors holen die benötigte Hardware aus dem Lager.
5. Jedes konkrete Gerät wird per QR-Code gescannt.
6. Durch den Scan wird das Gerät einem Projekt und idealerweise einer Person zugeordnet.
7. Bei Rückgabe wird das Gerät wieder eingescannt und freigegeben.
8. Defekte Geräte werden gemeldet und gehen in Wartung.
9. Nach Abschluss der Wartung stehen sie wieder zur Verfügung.

Die Anwendung muss deshalb klar unterscheiden zwischen:

- Bestand
- Planung
- Vorbereitung
- Ausgabe
- persönlicher Zuordnung
- Rückgabe
- Defekt/Wartung

---

## 3. Zielgruppe und Rollen

### 3.1 Admin / Techniker

Admin oder Techniker verwalten den Hardwarebestand.

Aufgaben:

- Geräte anlegen
- Geräte bearbeiten
- QR-Code erzeugen
- Kategorien verwalten
- Excel-Bestände importieren
- Geräte ausgeben und zurücknehmen
- Defekte bearbeiten
- Wartung abschließen
- fehlerhafte Buchungen korrigieren
- Massenaktionen durchführen

Admin darf alles korrigieren, aber die UI soll trotzdem möglichst einfach bleiben.

### 3.2 Projektmanager

Projektmanager planen den Hardwarebedarf.

Aufgaben:

- Projekt anlegen
- benötigte Hardwaremengen planen
- Verfügbarkeit prüfen
- Engpässe sehen
- Tages- oder Zeitraumplanung verwalten

Projektmanager planen in Mengen, z. B. „5 Laptops“, aber die reale Ausgabe erfolgt später über konkrete Geräte.

### 3.3 Mitarbeiter / Junior

Mitarbeiter nutzen die Software vor allem operativ.

Aufgaben:

- zugewiesene Geräte sehen
- Geräte per QR-Code scannen
- Ausgabe durchführen
- Rückgabe durchführen
- Defekte melden

Die Bedienung muss mobil, schnell und fehlertolerant sein.

---

## 4. Hauptmodule

### 4.1 Dashboard

Das Dashboard soll einen schnellen Überblick geben.

Mögliche Inhalte:

- Gesamtanzahl Geräte
- verfügbare Geräte
- verliehene Geräte
- defekte Geräte
- Geräte in Wartung
- aktuelle Projekte
- geplante Engpässe
- offene Defekte

Das Dashboard soll keine überladene Statistikseite sein, sondern eine schnelle Statusübersicht.

---

### 4.2 Inventar

Das Inventar ist die zentrale Geräteliste.

Hier werden alle konkreten Hardwareobjekte angezeigt.

Wichtige Felder:

- Checkbox für Mehrfachauswahl
- Name
- Kategorie
- Modell
- Seriennummer
- IP-Adresse
- MAC-Adresse LAN
- MAC-Adresse WLAN
- QR-Code / Asset-ID
- Zugeordnet an
- Projekt
- Systemstatus
- Notizen

Der Excel-Status aus alten Tabellen darf nicht als Hauptstatus verwendet werden. Er kann optional als Legacy-Hinweis in den Notizen gespeichert werden.

Systemstatus ist die eigene Logik des Systems.

Erlaubte Systemstatus:

- Verfügbar
- Verliehen
- Defekt
- In Wartung

#### Manuelle Geräteanlage

Beim manuellen Anlegen eines Geräts sollen folgende Felder möglich sein:

- Name
- Kategorie als Dropdown
- Modell
- Seriennummer
- IP-Adresse
- MAC-Adresse LAN
- MAC-Adresse WLAN
- Notizen

Wichtig:

- Kategorie ist kein Freitext.
- Neue Kategorien werden nur im Kategorien-Modul angelegt.
- Nach dem Speichern soll ein QR-Code erzeugt oder angezeigt werden können.

#### Mehrfachauswahl

Inventar muss Massenaktionen unterstützen.

Gewünschte Bedienung:

- Checkbox links pro Zeile
- eine Zeile auswählen
- Shift gedrückt halten
- spätere Zeile auswählen
- alle Zeilen dazwischen werden automatisch ausgewählt

Massenlöschung:

- Button „Ausgewählte löschen“
- Bestätigungsdialog mit Anzahl
- Schutz vor Löschen verliehener oder verplanter Geräte
- Warnung statt blindem Löschen

---

### 4.3 Kategorien

Kategorien sind Stammdaten.

Ziel:

- keine Freitext-Kategorien
- keine doppelten Bedeutungen
- keine falsche Zählung

Standard-Kategorien:

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
- Zubehör
- Sonstiges

Neue Kategorien dürfen nur im Kategorien-Modul angelegt werden.

Beim Geräte-Anlegen oder Importieren wird immer gegen diese Kategorien normalisiert.

#### Synonyme

Synonyme sollen auf eine feste Kategorie gemappt werden.

Beispiele:

- Notebook → Laptop
- Notebooks → Laptop
- Laptop → Laptop
- Laptops → Laptop
- Event Laptops → Laptop
- iPads → iPad
- iPad → iPad
- QR Scanner → QR-Code-Scanner
- QRCodescan → QR-Code-Scanner
- Barcode Scanner → QR-Code-Scanner
- Laserdrucker → Drucker
- Laser Drucker → Drucker
- Printer → Drucker
- Handhelden → Handheld
- MDE → Handheld
- Mobile Computer → Handheld
- LTE → LTE-Router

Unklare Kategorien sollen nicht automatisch als „Sonstiges“ importiert werden.

Stattdessen:

- Kategorie = Zuordnung erforderlich
- Nutzer kann später manuell zuweisen

---

### 4.4 Import / Export

Das Import-/Export-Modul ist wichtig für die Übernahme bestehender Hardwarebestände.

#### Grundregel

Die Anwendung darf keine Excel-Dateien automatisch aus einem Projektordner oder Backend-Ordner lesen.

Nicht erlaubt:

- automatischer Import aus `Hardwarebestand`
- Server-seitiger Ordner-Scan
- UI-Hinweis „Nutzt Dateien aus dem Ordner Hardwarebestand“
- Dry-Run über lokale Projektdateien

Stattdessen:

- Nutzer lädt Excel-Datei über die UI hoch
- Datei wird analysiert
- Preview wird angezeigt
- Nutzer bestätigt Import
- Daten werden in die Datenbank geschrieben

#### Datenschutz

Echte Excel-Bestände enthalten interne Daten.

Deshalb:

- `Hardwarebestand/*.xlsx` muss ignoriert werden
- `Hardwarebestand/*.xlsm` muss ignoriert werden
- echte Excel-Dateien dürfen nicht committed werden
- Beispiel-Dateien dürfen nur künstliche Beispieldaten enthalten

#### UI Import

Die Import-Karte soll ungefähr so aussehen:

Titel:

`Excel-Import`

Text:

`Ziehe eine Excel-Datei hier hinein oder wähle sie aus, um Hardware in das Inventar zu importieren.`

Elemente:

- Drag-&-Drop-Zone
- Button `Excel-Datei auswählen`
- Hinweis `Unterstützte Formate: .xlsx, .xlsm`
- Button `Beispiel-Excel herunterladen`
- nach Dateiauswahl Anzeige des Dateinamens
- Button `Import prüfen`
- nach Preview Button `Import übernehmen`

Nicht anzeigen:

- Dry-Run
- Import starten ohne Datei
- Hardwarebestand-Ordner-Hinweis

#### Backend-Endpunkte

Gewünschte Endpunkte:

```http
POST /api/wms/import/preview
POST /api/wms/import/confirm
GET /api/wms/import/template
```

`POST /api/wms/import/preview`

- multipart/form-data
- Datei: `.xlsx` oder `.xlsm`
- gibt Preview zurück

`POST /api/wms/import/confirm`

- übernimmt bestätigte Preview
- schreibt Datensätze in DB

`GET /api/wms/import/template`

- liefert `hardware_import_vorlage.xlsx`
- nur Beispieldaten

#### Beispiel-Excel

Beispiel-Datei:

`hardware_import_vorlage.xlsx`

Beispielstruktur:

- optionale Titelzeile: `Event Laptops`
- Header:
  - Name
  - Modell
  - Seriennummer
  - IP-Adresse
  - Mac-Adresse LAN
  - Mac-Adresse WLAN
  - Kategorie
  - Notizen

Beispielwerte dürfen keine echten internen Daten enthalten.

---

## 5. Excel-Importlogik

Der Excel-Import muss robust genug für echte gewachsene Excel-Listen sein.

Viele Listen sind nicht perfekt standardisiert.

Der Import darf deshalb nicht starr an einer einzigen Vorlage hängen.

### 5.1 Erkennungsquellen für Kategorie

Kategorie soll aus mehreren Quellen erkannt werden.

Priorität:

1. explizite Kategorie-Spalte
2. Headernamen
3. Sheetname
4. Dateiname
5. Titelzeile im Excel

Beispiele:

- Header `iPad` → Kategorie `iPad`
- Dateiname `Genolive Laserdrucker.xlsx` → Kategorie `Drucker`
- Dateiname `event_handhelden.xlsx` → Kategorie `Handheld`
- Dateiname `event_qrcodescan.xlsx` → Kategorie `QR-Code-Scanner`
- Titelzeile `Event Laptops` → Kategorie `Laptop`

### 5.2 Titelzeilen

Viele Excel-Dateien haben in der ersten Zeile nur einen Titel.

Beispiel:

`Event Laptops`

Diese Zeile darf nicht als Datensatz importiert werden.

Der Parser soll die echte Header-Zeile erkennen.

### 5.3 Flexible Header-Aliase

#### Name

Folgende Header sollen als Name erkannt werden:

- Name
- Gerätename
- Gerät
- Bezeichnung
- Nummer
- ID

#### Seriennummer

- Seriennummer
- Serial
- Serial Number
- S/N
- SN
- Serien-Nr
- Seriennr
- Serien Nr.

#### Modell

- Modell
- Model
- Gerätetyp
- Typ
- Type
- Produkt
- Produktname

#### IP-Adresse

- IP
- IP-Adresse
- IP Adresse
- IPv4
- Netzwerkadresse

#### MAC allgemein

- MAC
- Mac-Adresse
- MAC-Adresse
- Hardwareadresse

#### MAC LAN

- MAC LAN
- Mac-Adresse LAN
- LAN MAC
- Ethernet MAC
- RJ45 MAC

#### MAC WLAN

- MAC WLAN
- Mac-Adresse WLAN
- WLAN MAC
- WiFi MAC
- WLAN-MAC
- Wireless MAC

#### Zubehör / Hinweise

Diese Felder können optional in Notizen übernommen werden:

- Netzteil
- Ladegerät
- Zubehör
- Bemerkung
- Hinweis
- Standort

### 5.4 Einfache Listen ohne Gerätenamen

Einige Excel-Dateien haben keinen echten Gerätenamen.

Beispiel iPads:

| iPad | Seriennummer | Mac-Adresse |
|---|---|---|
| 1 | ABC123 | 60:DD:70:AA:23:D5 |
| 2 | DEF456 | 10:9F:41:3B:8F:C8 |

Logik:

- Header `iPad` erkennt Kategorie `iPad`
- Wert aus Spalte `iPad` wird zur Namensbildung genutzt
- Name wird automatisch `iPad 1`, `iPad 2`, usw.
- Seriennummer wird übernommen
- Mac-Adresse wird bei iPads als WLAN-MAC gespeichert

Weitere Beispiele:

- `Drucker` + Nummer → `Drucker 1`
- `Handheld` + Nummer → `Handheld 1`
- `QR-Code-Scanner` + Nummer → `QR-Code-Scanner 1`

### 5.5 Pflichtfelder

Der Import soll nicht zu streng sein.

Ein Datensatz ist gültig, wenn:

- Kategorie erkannt wurde
- und mindestens eines der folgenden Identifikationsmerkmale vorhanden ist:
  - Seriennummer
  - Name
  - MAC-Adresse LAN
  - MAC-Adresse WLAN
  - IP-Adresse

Wenn kein Name vorhanden ist, darf er automatisch erzeugt werden.

Wenn keine Seriennummer vorhanden ist, darf eine technische AUTO-Seriennummer erzeugt werden.

### 5.6 AUTO-Seriennummern

Wenn eine echte Seriennummer fehlt, soll eine deterministische technische Seriennummer erzeugt werden.

Wichtig:

- nicht zufällig
- stabil bei erneutem Import
- verhindert Duplikate

Beispiel:

`AUTO-DRUCKER-<hash>`

Hash-Basis:

- Kategorie
- Name
- MAC-Adresse
- IP-Adresse

AUTO-Seriennummern sind technische Fallbacks und keine echten Seriennummern.

### 5.7 Duplikaterkennung

Priorität:

1. echte Seriennummer
2. MAC-Adresse LAN oder WLAN
3. Name + Kategorie
4. IP-Adresse + Kategorie
5. AUTO-Seriennummer als technischer Fallback

Wichtig:

- derselbe Import darf nicht mehrfach dieselben Geräte erzeugen
- Duplikate sollen in Preview sichtbar sein
- Import soll nicht blind überschreiben

### 5.8 MAC-Adresslogik

Wenn MAC-Feld eindeutig ist:

- MAC LAN → `macAddressLan`
- MAC WLAN → `macAddressWlan`

Wenn nur `Mac-Adresse` vorhanden ist:

- bei iPad, Smartphone, Tablet → WLAN-MAC
- bei Drucker, Switch, Router → LAN-MAC
- bei unbekannter Kategorie → allgemeine MAC als Notiz oder bestmögliche Zuordnung

MAC-Anzeige im UI darf normalisiert sein, z. B. mit Doppelpunkten statt Bindestrichen.

### 5.9 Excel-Status

Excel-Dateien enthalten teilweise Status wie:

- OK
- defekt
- verfügbar

Dieser Status darf nicht direkt als Systemstatus verwendet werden.

Importierte Geräte bekommen standardmäßig:

`Verfuegbar`

Excel-Status kann in Notizen übernommen werden:

`Import-Status (Legacy): OK`

---

## 6. Import-Preview

Vor dem finalen Import muss eine Vorschau angezeigt werden.

Preview soll enthalten:

- erkannte Datei
- erkannte Sheets
- erkannte Header-Zeile
- erkannte Spalten
- erkannte Kategorie
- Quelle der Kategorie
- Anzahl Gesamtzeilen
- Anzahl gültiger Zeilen
- Anzahl neuer Geräte
- Anzahl Duplikat-Kandidaten
- Anzahl unklare Kategorien
- Anzahl automatisch erzeugter Namen
- Anzahl automatisch erzeugter AUTO-Seriennummern
- Warnungen pro Zeile
- Fehler pro Zeile

Wenn Kategorie unklar:

- nicht importieren
- in „Zuordnung erforderlich“ anzeigen
- Nutzer soll später Kategorie zuweisen können

Import-Preview soll kein technisches Debugging sein, sondern verständlich für normale Nutzer.

---

## 7. Export

Export darf bestehen bleiben.

Funktion:

- aktueller Datenbankbestand als CSV exportieren

Wording:

`Inventar als CSV exportieren`

Beschreibung:

`Exportiert den aktuellen Datenbankbestand als CSV.`

Export darf nicht aus alten Excel-Dateien lesen.

---

## 8. Einsatzplanung

Die Einsatzplanung plant Hardwarebedarf pro Projekt.

Planung erfolgt zunächst auf Kategorie- und Mengenebene.

Beispiel:

- Projekt A benötigt 5 Laptops vom 01.05. bis 03.05.
- Projekt B benötigt 3 iPads am 02.05.

Die Planung muss gegen den real verfügbaren Bestand rechnen.

### Availability-Berechnung

Wichtige Werte:

- `totalStock`
- `usableStock`
- `alreadyPlanned`
- `remainingQty`

Ein Gerät zählt nur als verfügbar, wenn:

- Status = Verfügbar
- kein aktiver Defekt existiert
- keine aktive Wartung existiert
- es nicht bereits verliehen ist

Planungen reduzieren den verfügbaren Bestand.

Ausgegebene Geräte zählen nicht als verfügbar.

Engpässe müssen sichtbar sein.

---

## 9. Ein-/Auslagerung und QR-Flow

Der QR-Flow ist einer der wichtigsten Praxisabläufe.

Ziel:

- Gerät scannen
- Gerät erkennen
- Projekt auswählen
- Person auswählen
- Ausgabe buchen
- Rückgabe buchen

Wichtige Regeln:

- konkrete Geräte werden per QR-Code identifiziert
- Ausgabe setzt Gerät auf verliehen oder zugeordnet
- Rückgabe setzt Gerät wieder verfügbar, sofern kein Defekt gemeldet wurde
- Projekt- und Personenzuordnung sollen nachvollziehbar bleiben

Späterer Wunsch:

- mobile Kamera-Scan-Funktion
- schnelle Ausgabe für mehrere Geräte
- Scan-Historie

---

## 10. Defekt und Wartung

Defekt-/Wartungsmodul soll bewusst einfach bleiben.

Workflow:

1. Offen
2. In Bearbeitung
3. Erledigt

### Statuslogik

Defektmeldung:

- Wartungsfall wird erstellt
- Asset wird auf `Defekt` gesetzt

In Bearbeitung:

- Asset wird auf `In Wartung` gesetzt

Erledigt:

- Wartungsfall wird abgeschlossen
- Asset wird nur dann wieder `Verfügbar`, wenn kein weiterer aktiver Defekt existiert

Aktive Fälle:

- Offen
- In Bearbeitung

Erledigte Fälle sollen nicht mehr im aktiven Board erscheinen.

---

## 11. Login und Stabilität

Login darf nicht unendlich hängen.

Wenn Backend nicht erreichbar ist:

- Login-Request muss nach ca. 10 Sekunden abbrechen
- Nutzer bekommt klare Fehlermeldung

Beispielmeldung:

`Anmeldung fehlgeschlagen: Backend nicht erreichbar oder Server antwortet nicht.`

Backend-Import-Router darf den App-Start nicht blockieren.

Wenn optionale Dependencies fehlen, z. B. `python-multipart`, darf nicht die ganze App kaputtgehen.

Stattdessen:

- Import-Endpunkt gibt klare 503-Meldung
- Login und restliche App bleiben nutzbar

---

## 12. Technische Architektur

### 12.1 Frontend

Frontend ist eine Webanwendung.

Wichtige Punkte:

- klare Modulnavigation
- mobile Nutzung berücksichtigen
- einfache Dialoge
- keine Browser-`alert`/`prompt`/`confirm`, wenn möglich
- zentrale API-Schicht
- verständliche Fehlermeldungen

Bereiche:

- Dashboard
- Inventar
- Kategorien
- Import / Export
- Einsatzplanung
- Ein-/Auslagerung
- QR
- Tickets / Defekte
- Benutzerverwaltung

### 12.2 Backend

Backend stellt API-Endpunkte bereit.

Wichtige Bereiche:

- Assets / Inventar
- Kategorien
- Import
- Export
- Planung
- Ein-/Auslagerung
- Defekte / Wartung
- Auth / Login

Backend muss robuste Validierung liefern.

Fehler sollen als verständliches JSON zurückkommen.

### 12.3 Datenhaltung

Ziel ist persistente Datenhaltung in der Datenbank.

Excel-Dateien sind nur Importquellen, keine permanente Datenquelle.

Nach Import liegen die Assets in der Datenbank.

---

## 13. Datenmodell – fachlich

### 13.1 Asset

Ein Asset ist ein konkretes Gerät.

Felder:

- id
- assetId / qrCodeId
- name
- category
- model
- serialNumber
- ipAddress
- macAddressLan
- macAddressWlan
- status
- assignedTo
- assignedProject
- notes
- sourceFile optional
- createdAt
- updatedAt

### 13.2 Category

Kategorie-Stammdaten.

Felder:

- id
- name
- aliases / synonyms
- active

### 13.3 PlanningRecord

Planung für Projekt oder Event.

Felder:

- id
- projectName
- startDate
- endDate
- status
- items

### 13.4 PlanningItem

Geplanter Bedarf.

Felder:

- category
- quantity
- date / period

### 13.5 MaintenanceTicket

Defekt- oder Wartungsfall.

Felder:

- id
- assetId
- title
- description
- status
- createdBy
- createdAt
- resolvedAt

---

## 14. UI-/UX-Prinzipien

Grundsatz:

`Weniger ist mehr.`

Die Anwendung soll von normalen Mitarbeitern schnell verstanden werden.

Regeln:

- keine überladenen Formulare
- keine unnötigen Pflichtfelder
- wichtige Felder gruppieren
- große Klickflächen
- mobil nutzbar
- klare Fehlermeldungen
- direkte Aktionen
- wenig verschachtelte Menüs
- Dropdown statt Freitext bei Stammdaten
- Importfehler verständlich anzeigen
- technische Details nur wenn nötig

---

## 15. Sicherheit und Datenschutz

Echte Hardwarelisten können sensible interne Informationen enthalten:

- Seriennummern
- IP-Adressen
- MAC-Adressen
- Gerätenamen
- Projektbezüge

Regeln:

- echte Excel-Dateien nicht committen
- `.gitignore` muss Hardwarebestand-Dateien ausschließen
- keine Secrets committen
- keine produktiven Serverpfade ändern
- keine Cloudflare-/Runtime-Konfiguration ohne explizite Anweisung ändern
- Import nur per UI-Upload
- keine versteckten lokalen Datenquellen

---

## 16. Git- und Entwicklungsregeln

### Keine Full-Rebuilds

Bestehende Struktur beibehalten.

Nur gezielte Verbesserungen.

### Vor Änderungen

- relevante Dateien lesen
- bestehende Architektur verstehen
- AGENTS.md beachten
- PROJECT_CONTEXT.md beachten

### Nach Änderungen

Immer validieren:

```bash
npm --prefix frontend run build
python -m compileall app
```

Falls pytest verfügbar:

```bash
.\backend\.venv\Scripts\python.exe -m pytest backend\tests
```

Falls venv fehlt:

```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\python.exe -m pip install --upgrade pip
.\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -r backend\requirements-dev.txt
.\backend\.venv\Scripts\python.exe -m pytest backend\tests
```

### Git-Regeln

Vor Commit prüfen:

```bash
git status --short
git ls-files Hardwarebestand/*
```

Erwartung:

- keine echten Excel-Dateien getrackt
- keine `.env`-Dateien getrackt
- keine lokalen Testartefakte getrackt

---

## 17. Bekannte wichtige Projektentscheidungen

### 17.1 Kein Ordnerimport mehr

Früher gab es Logik, die Dateien aus `Hardwarebestand` gelesen hat.

Diese Logik ist fachlich falsch für die finale Anwendung.

Entscheidung:

- kein automatischer Ordnerimport
- nur UI-Dateiupload
- Daten danach in Datenbank

### 17.2 Excel-Status ist nicht Systemstatus

Excel-Status ist Altbestand.

Systemstatus wird vom WMS verwaltet.

### 17.3 Kategorien sind Stammdaten

Keine Freitexte bei Geräten.

Neue Kategorien nur im Kategorien-Modul.

### 17.4 Unklare Kategorien nicht blind importieren

Keine automatische Zuordnung zu „Sonstiges“, wenn Kategorie unklar ist.

Besser:

- Zuordnung erforderlich
- Nutzer entscheidet

### 17.5 Import muss echte Excel-Varianten tolerieren

Echte Excel-Dateien sind unterschiedlich.

Der Importer muss robust sein:

- andere Header
- fehlende Felder
- Titelzeilen
- einfache Listen
- Kategorien aus Dateinamen
- automatische Namen
- AUTO-Seriennummern

---

## 18. Aktueller wichtiger Arbeitsstand

Bereits umgesetzt oder geplant:

- Excel-Dateien aus `Hardwarebestand` aus Git-Tracking entfernt
- `.gitignore` schützt `Hardwarebestand/*.xlsx` und `Hardwarebestand/*.xlsm`
- Import über UI-Dateiupload eingeführt
- Preview-/Confirm-Flow vorhanden
- Beispiel-Excel-Download vorhanden
- Ordnerimport soll nicht mehr aktiv erreichbar sein
- Inventar zeigt echte Hardwarefelder
- manuelle Geräteanlage erweitert
- Kategorie als Dropdown
- Shift-Mehrfachauswahl im Inventar
- Massenlöschung mit Schutz bei verliehenen/verplanten Geräten
- Login mit Timeout bei Backend-Problemen
- Importer für Laptop-/Notebook-Listen erweitert
- Importer für einfache iPad-Listen erweitert
- weitere Importvarianten sollen unterstützt werden:
  - `event_handhelden.xlsx`
  - `event_qrcodescan.xlsx`
  - `Genolive Laserdrucker.xlsx`

---

## 19. Nächste sinnvolle Entwicklungsschritte

### 19.1 Import-Routine weiter verbessern

Priorität hoch.

Noch robuster machen für:

- Handheld-Dateien
- QR-Code-Scanner-Dateien
- Laserdrucker-Dateien
- Dateien mit fehlender Seriennummer
- Dateien mit nur MAC oder IP
- Dateinamen-/Sheetnamen-basierte Kategorieerkennung

### 19.2 Import-Preview mit manueller Kategoriezuordnung

Wenn Kategorie unklar:

- Zeilen in Tabelle anzeigen
- Nutzer wählt Kategorie per Dropdown
- danach Import übernehmen

### 19.3 QR-Ausgabe-Flow

Wichtiger nächster Produktivitätsgewinn:

- QR scannen
- Gerät anzeigen
- Projekt wählen
- Person wählen
- Ausgabe buchen
- Rückgabe buchen

### 19.4 Mobile Geräteerfassung

Neue Hardware direkt per Smartphone erfassen:

- Kategorie wählen
- Name eingeben
- Seriennummer/MAC optional
- QR-Code erzeugen
- direkt drucken oder anzeigen

### 19.5 Inventar-Details verbessern

- Detailseite pro Gerät
- Historie anzeigen
- aktuelle Zuordnung
- letzte Projekte
- Defekt-Historie
- QR-Code anzeigen

---

## 20. Cloud Code / Codex Arbeitsanweisung

Wenn Cloud Code oder Codex an diesem Projekt arbeitet, gelten folgende Regeln:

1. Lies zuerst:
   - `AGENTS.md`
   - `PROJECT_CONTEXT.md`
   - `Specs.md`
2. Keine großen Umbauten ohne Not.
3. Kein Full-Rebuild.
4. Keine Runtime-/Server-/Cloudflare-/Secrets-Änderungen.
5. Echte Excel-Dateien nicht committen.
6. Keine lokale Ordnerimport-Logik zurückbringen.
7. Import muss per UI-Dateiupload funktionieren.
8. Änderungen immer testen.
9. Bei fehlenden Tests ehrlich dokumentieren, warum sie nicht laufen.
10. Nach Änderungen kurze Zusammenfassung geben:
    - Ursache
    - Änderung
    - Dateien
    - Tests
    - bekannte Einschränkungen

---

## 21. Definition of Done

Eine Änderung gilt als fertig, wenn:

- fachlicher Ablauf funktioniert
- UI verständlich ist
- Backend stabil antwortet
- Build erfolgreich ist
- kein sensibler Bestand committed wird
- keine alten Ordnerimport-Hinweise sichtbar sind
- Tests oder mindestens Compile-/Build-Checks durchgeführt wurden
- Nutzerfehler verständlich angezeigt werden

Mindestvalidierung:

```bash
npm --prefix frontend run build
python -m compileall app
```

Optional:

```bash
.\backend\.venv\Scripts\python.exe -m pytest backend\tests
```

---

## 22. Beispiel-Prompt für weitere Aufgaben

Wenn eine neue Aufgabe an Cloud Code gegeben wird, sollte sie ungefähr so aufgebaut sein:

```md
Bitte gezielt und ohne Full-Rebuild umsetzen.

Lies zuerst:
- AGENTS.md
- PROJECT_CONTEXT.md
- Specs.md

Aufgabe:
[Beschreibung]

Wichtig:
- keine echten Excel-Dateien committen
- keine Secrets ändern
- keine Runtime-/Server-Konfiguration ändern
- bestehende Architektur beibehalten

Validierung:
- npm --prefix frontend run build
- python -m compileall app
- falls verfügbar: pytest

Bitte danach berichten:
- geänderte Dateien
- Ursache
- Lösung
- Tests
- offene Einschränkungen
```

---

## 23. Kurzfassung

Dieses Projekt soll eine einfache, robuste und praxisnahe Hardware-Warenwirtschaft werden.

Der wichtigste Fokus liegt auf:

- sauberem Inventar
- stabilen Kategorien
- echtem Excel-Upload-Import
- QR-basierter Ausgabe/Rückgabe
- Projektplanung
- einfacher Bedienung
- Schutz interner Daten

Die Software soll reale Arbeitsabläufe abbilden, nicht nur technisch funktionieren.
