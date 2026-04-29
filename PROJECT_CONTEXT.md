# Warehouse-System – Projektkontext

## 🧠 Ziel der Anwendung

Die Anwendung ist eine **Hardware-Warenwirtschaft für Akkreditierungsprojekte**.

Ziel:
- Hardwarebestand verwalten (z. B. iPads, Laptops, Handhelds)
- Hardware projektbezogen planen
- reale Geräte per QR-Code verwalten
- Geräte Personen und Projekten zuordnen
- Ausgabe und Rückgabe nachvollziehen
- Defekte/Wartung einfach bearbeiten

Die Anwendung soll **praxisnah, einfach und effizient** sein – kein kompliziertes ERP.

---

## 🧱 Grundprinzip

Die Software bildet den echten Ablauf im Unternehmen ab:

1. Projekt wird geplant
2. Hardwarebedarf wird definiert
3. Mitarbeiter holen Geräte aus dem Lager
4. Geräte werden per QR-Code gescannt
5. Geräte werden:
   - einem Projekt
   - einer Person
   zugeordnet
6. Geräte werden zurückgegeben
7. Defekte werden gemeldet und bearbeitet

---

## 👥 Rollen

### Admin / Techniker
- verwaltet Hardwarebestand
- legt neue Geräte an (inkl. QR-Code)
- verwaltet Kategorien
- bearbeitet Defekte / Wartung
- kann alles korrigieren (Admin-Rechte)

### Projektmanager
- plant Hardwarebedarf pro Projekt
- sieht Verfügbarkeit und Engpässe
- nutzt Einsatzplanung

### Mitarbeiter / Junior
- sieht zugewiesene Hardware
- scannt Geräte (Ausgabe/Rückgabe)
- meldet Defekte

---

## 📊 Hauptmodule

### 1. Inventar
- Geräte anlegen (mobil optimiert)
- QR-Code generieren
- Status:
  - Verfügbar
  - Verliehen
  - Defekt
  - In Wartung

### 2. Einsatzplanung
- Hardwarebedarf pro Projekt planen
- Tages-/Zeitraumplanung
- Availability-Berechnung:
  - totalStock
  - usableStock
  - alreadyPlanned
  - remainingQty

### 3. Ein-/Auslagerung
- Geräte scannen
- auf Person + Projekt buchen
- Rückgabe durchführen

### 4. Defekt / Wartung (vereinfacht!)
- Workflow:
  - Offen
  - In Bearbeitung
  - Erledigt

Wichtig:
- Board nur für aktive Fälle (Offen / In Bearbeitung)
- Erledigt = Abschluss → verschwindet aus Board
- Asset wird danach wieder **Verfügbar**

---

## 🔧 Wichtige Fachlogik

### Geräteverfügbarkeit
Ein Gerät ist nur verfügbar, wenn:
- Status = Verfügbar
- kein aktiver Defekt/Wartung existiert

---

### Wartungslogik

- Defektmeldung:
  → Asset wird auf **Defekt** gesetzt

- In Bearbeitung:
  → Asset = **In Wartung**

- Erledigt:
  → Asset wird nur dann **Verfügbar**, wenn:
    - kein weiterer Defekt offen ist

---

### Einsatzplanung

- Planung reduziert **verfügbaren Bestand**
- ausgegebene Geräte zählen NICHT als verfügbar
- Engpässe müssen sichtbar sein

---

## 🧩 Kategorien (sehr wichtig)

Es gibt feste Kategorien (keine Freitexte):

Beispiele:
- Laptop
- iPad
- Handheld
- QR-Code-Scanner
- Drucker
- Router
- Switch

### Regel:
- neue Hardware → Kategorie per Dropdown
- neue Kategorien nur im Kategorien-Modul
- Synonyme werden gemappt (Notebook → Laptop)

Ziel:
→ keine doppelte oder falsche Zählung

---

## 📱 UX-Prinzipien

- **weniger ist mehr**
- einfache Buttons
- keine komplexen Formulare
- mobile Nutzung wichtig
- klare Status (keine unnötigen Zwischenstufen)
- direkte Aktionen statt verschachtelter Prozesse

---

## 🔁 Entwicklungs-Workflow

### Lokal
- Entwicklung in VS Code
- lokal testen

### Deployment
```bash
git add .
git commit -m "..."
git push origin main