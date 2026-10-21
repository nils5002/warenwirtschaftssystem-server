# Rollen- und Rechte-Matrix (IST-Stand)

Diese Datei dokumentiert den aktuell implementierten Zustand (Backend + Frontend) für Rollen, Sichtbarkeit und API-Guards.

## 1. Rollenübersicht

| Rolle | Zweck |
|---|---|
| Admin / Techniker | Vollzugriff auf Bestand, Stammdaten, Benutzer, Korrekturen, Import/Export |
| Projektmanager | Planung, Verfügbarkeit, Projektstatus |
| Mitarbeiter / Junior | Operative QR-gestützte Ausgabe/Rückgabe, Ticketmeldung im Tagesgeschäft |

## 2. Screens / Module

Legende: `erlaubt` = voll, `eingeschränkt` = nur Teilfunktionen, `nicht erlaubt` = gesperrt.

| Screen / Modul | Admin | Projektmanager | Mitarbeiter |
|---|---|---|---|
| Dashboard | erlaubt | erlaubt | erlaubt |
| Einsatzplanung | erlaubt | erlaubt | eingeschränkt (Leseansicht) |
| Inventar | erlaubt | eingeschränkt (keine Admin-Aktionen) | eingeschränkt (operativ) |
| Ein-/Auslagerung | erlaubt | nicht erlaubt | erlaubt |
| Tickets / Defekte | erlaubt | erlaubt | eingeschränkt (melden, kein Admin-Abschlusszwang) |
| Benutzerverwaltung | erlaubt | nicht erlaubt | nicht erlaubt |
| Import / Export | erlaubt | nicht erlaubt | nicht erlaubt |
| Kategorien / Stammdaten | erlaubt | nicht erlaubt | nicht erlaubt |

## 3. Aktionen / Rechte

| Aktion | Admin | Projektmanager | Mitarbeiter |
|---|---|---|---|
| Benutzer anlegen / bearbeiten | erlaubt | nicht erlaubt | nicht erlaubt |
| Asset anlegen / bearbeiten | erlaubt | nicht erlaubt | eingeschränkt (nur Ausgabe/Rückgabe-Statuswechsel) |
| Asset löschen | erlaubt | nicht erlaubt | nicht erlaubt |
| QR-Code erzeugen (bei Asset-Anlage) | erlaubt | nicht erlaubt | nicht erlaubt |
| Geräte scannen | erlaubt | eingeschränkt (nur Sicht/Status) | erlaubt |
| Geräte ausgeben | erlaubt | nicht erlaubt | erlaubt |
| Geräte zurückgeben | erlaubt | nicht erlaubt | erlaubt |
| Einsatzplanung anlegen / bearbeiten / speichern | erlaubt | erlaubt | nicht erlaubt |
| Einsatzplanung duplizieren / Status ändern | erlaubt | erlaubt (im Scope) | nicht erlaubt |
| Tickets anlegen | erlaubt | erlaubt | erlaubt |
| Tickets administrativ verwalten / löschen | erlaubt | eingeschränkt | nicht erlaubt |
| Import / Export | erlaubt | nicht erlaubt | nicht erlaubt |
| Stammdatenpflege | erlaubt | nicht erlaubt | nicht erlaubt |
| Admin-Korrekturen (manuelle Zuordnung, Reset, Force Return) | erlaubt | nicht erlaubt | nicht erlaubt |
| Bulk-Aktionen im Inventar | erlaubt | nicht erlaubt | nicht erlaubt |

## 4. API-Ebene (Kurzüberblick)

### `/api/wms/users`
- Admin: `GET/POST/DELETE` erlaubt.
- Projektmanager/Mitarbeiter: geblockt (`403`).

### `/api/wms/assets`
- Admin: volle Schreibrechte inkl. `DELETE`.
- Projektmanager: `POST` geblockt (`403`).
- Mitarbeiter: `POST` nur für Ausgabe/Rückgabe-Statuswechsel erlaubt; Masterdatenänderungen geblockt.

### `/api/wms/planning`
- Admin: voll.
- Projektmanager: CRUD im eigenen Scope erlaubt.
- Mitarbeiter: Lesen nur mit Projektkontext; Erstellen/Bearbeiten/Status/Duplizieren/Löschen geblockt.

### `/api/companion` (Companion App)
- Alle Rollen: nur **eigene** Einstellungen und Geräte (fremde Geräte/Kopplungen → `404`).
- Kopplung starten/bestätigen nur aus einer Browser-Sitzung am PC, nie von einem gekoppelten Gerät (`403`).
- Gekoppelte Geräte nutzen die bestehenden Endpunkte mit exakt den Rechten der Rolle — keine Sonderrechte.

### `/api/wms/maintenance`
- Admin: voll.
- Projektmanager: erstellen/bearbeiten erlaubt.
- Mitarbeiter: erstellen erlaubt, Status serverseitig auf `Offen` begrenzt.

## 5. Projektkontext / Scope

Implementierte Header:

| Header | Bedeutung |
|---|---|
| `X-User-Role` | aktive Rolle (`Admin`, `Projektmanager`, `Mitarbeiter`) |
| `X-User-Id` | Benutzerkennung für PM-Scopes |
| `X-Project-Context` | Projektfilter/Scope (ein oder mehrere Kontexte, komma-separiert) |

Nicht-Admin Einschränkungen:
- Projektmanager sieht/bearbeitet Planungen nur im eigenen Scope (z. B. `projectManagerUserId` passend).
- Mitarbeiter benötigen Projektkontext für Planungszugriffe und haben nur operative Asset-Rechte.
- Kritische Admin-Aktionen werden serverseitig mit `403` blockiert.

## 6. Hinweise für Entwickler

- UI-Ausblendung ist nur Komfort; die eigentliche Absicherung liegt serverseitig in den Route-Guards.
- Für neue Endpunkte dieselben Guard-Muster verwenden (`Role`, optional `Scope`).
- Bei Änderungen an Rollenrechten diese Datei zusammen mit API-Tests aktualisieren.
