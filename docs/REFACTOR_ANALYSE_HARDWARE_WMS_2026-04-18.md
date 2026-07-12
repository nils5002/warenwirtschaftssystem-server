# Hardware-WMS Refactor Analyse (2026-04-18)

## 1) Ist-Analyse der bestehenden Softwarebasis

### Positiv (bleibt erhalten)
- Saubere technische Trennung im Backend (`routes`, `services`, `repositories`, `schemas`, `database`).
- Import-Pipeline bereits modular aufgebaut (`parser`, `validator`, `mapper`, `importer`).
- Frontend bereits component-basiert mit responsiven Seiten.
- QR-Scanner (Kamera + Fallback) schon vorhanden.
- DB-Layer mit Alembic bereits eingerichtet.

### Probleme im Ist-Zustand
- UI-Hauptnavigation war zu breit/techniklastig (Reservierungen, Standorte als Hauptfokus).
- Asset-Status war inkonsistent (`Reserviert`, `Ausgegeben`, `Unterwegs`, `Verloren` etc.).
- Kategorien waren nicht auf die gewünschte Zielstruktur normiert.
- Import hat reale Excel-Fälle nicht optimal abgebildet:
  - numerische Spalten (`iPad`, `Nummer`) führten zu unbrauchbaren Namen (`1`, `2`, ...).
  - zusätzliche Spalten (`SIM-Kartennummer`, `Rufnummer`, `Netzteil`, `Sprache`) wurden nicht sauber berücksichtigt.
  - einzelne fehlerhafte IP/MAC-Werte führten zu Zeilenfehlern statt zu robuster Bereinigung.
- Rollenmodell war unnötig komplex (mehrere Rollenvarianten).

---

## 2) Umgesetzte Refactorings (gezielt, kein Full-Rebuild)

### A) Import, Kategorien, Datenqualität (Backend)
- Kategoriesystem auf Zielkategorien umgestellt:
  - `iPads`, `Notebooks`, `Smartphones`, `QR-Code-Scanner`, `Handhelds`, `Drucker`, `Kartendrucker`, `Switches`, `Router`, `LTE-Router`.
- Dateibasierte + keyword-basierte Kategorisierung verbessert.
- Parser um echte Excel-Spalten erweitert:
  - `inventory_number`, `sim_number`, `phone_number`, `power_supply`, `language`.
- Mapper verbessert:
  - sinnvolle Gerätenamen aus realen Dateien (`Handheld 1`, `iPad 12` statt rein numerisch),
  - Standortableitung aus Dateikontext (`Eventlager`, `Genolive Lager`, `Hauptlager`),
  - Zusatzinformationen in Notizen übernommen (SIM/Rufnummer/Netzteil/Sprache).
- Import-Robustheit erhöht:
  - ungültige IP/MAC werden bereinigt statt Importabbruch,
  - Hinweise werden in Import-Notizen protokolliert.
- Ergebnis-Check: Dry-Run über `Hardwarebestand` läuft ohne Fehler.

### B) Status- und Rollenvereinfachung (Backend + Frontend)
- Einheitlicher Kernstatus für Assets:
  - `Verfügbar`, `Verliehen`, `Defekt`, `In Wartung`.
- Altstatuswerte werden kompatibel auf den Kernstatus normalisiert.
- Rollenmodell vereinheitlicht:
  - `Admin`, `Mitarbeiter` (Altrollen werden auf `Mitarbeiter` normalisiert).
- Benutzerstatus vereinheitlicht:
  - `Aktiv`, `Inaktiv`.
- Optionalfelder ergänzt:
  - `department`, `location` (DB + API + UI).

### C) Navigation und Bedienbarkeit (Frontend)
- Hauptbereiche auf die gewünschte Zielstruktur umgestellt:
  - `Dashboard`, `Inventar`, `Kategorien`, `Ein-/Auslagerung`, `QR-Code`, `Defekte / Tickets`, `Import / Export`, `Benutzerverwaltung`.
- Dashboard auf Kerninfos reduziert:
  - Gesamtgeräte, verfügbar, verliehen, defekt, letzte Aktivitäten.
- Neue schlanke Seiten ergänzt:
  - Kategorienübersicht,
  - QR-Schnellaktionen,
  - Import/Export (inkl. Importlauf-Feedback + CSV-Export).
- UI-Texte auf Praxisbetrieb vereinfacht.

### D) Migration
- Neue Alembic-Migration:
  - `20260418_0003_user_profile_fields_and_normalization.py`.

---

## 3) Was bewusst NICHT blind neu gebaut wurde

- Bestehende modulare Backend-Struktur bleibt vollständig erhalten.
- Import-Pipeline wurde erweitert statt ersetzt.
- Vorhandene Seiten wurden gezielt entschlackt/neu zugeordnet statt komplette UI-Neuentwicklung.
- Legacy-/Kompatibilitätsteile bleiben vorerst bestehen, um Brüche zu vermeiden.

---

## 4) Offene nächste Schritte (empfohlen, priorisiert)

1. **Echtes Login + serverseitige Rechteprüfung**
   - einfache Auth (Email/Benutzername + Passwort),
   - Rollenprüfung im Backend für kritische Aktionen (`Import/Export`, `Benutzerverwaltung`, Asset-Stammdaten).

2. **Asset-Historie als eigene Ereignisstruktur**
   - eindeutige Eventtypen (`checkout`, `checkin`, `defect_reported`, ...),
   - Zeitstempel + Benutzer + optional Kommentar.

3. **Tickets fachlich trennen von Wartung**
   - separates Ticketmodell mit Status `Offen`, `In Bearbeitung`, `Erledigt`,
   - optional Dateiupload (Foto) persistent im Backend.

4. **Kategorien als Stammdatentabelle**
   - zentrale DB-Tabelle für Kategorien,
   - Validierung beim Asset-Update/Import.

5. **QR-Deep-Link finalisieren**
   - QR direkt auf Mobile-Asset-Detailroute mit Quick-Actions und optional Auth-Guard.

