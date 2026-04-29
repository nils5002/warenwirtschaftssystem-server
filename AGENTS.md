# 🤖 AGENTS.md – Codex Projektregeln

## 🧠 Ziel dieser Datei

Diese Datei beschreibt, wie AI-Agenten (z. B. Codex) in diesem Projekt arbeiten sollen.

Wichtig:
- Das Projekt ist eine **Hardware-Warenwirtschaft**
- Fokus liegt auf **Praxisnähe, Einfachheit und korrekter Fachlogik**
- Änderungen sollen **gezielt und ohne Full-Rebuild** erfolgen

---

## 📦 Projektkontext

Bitte zuerst lesen:
👉 `PROJECT_CONTEXT.md`

Diese Datei beschreibt:
- Business-Logik
- Rollen
- Abläufe
- Ziel der Anwendung

Alle Änderungen müssen sich daran orientieren.

---

## ⚙️ Grundregeln für Änderungen

### ❗ Kein Full-Rebuild
- Bestehende Struktur beibehalten
- Keine unnötigen großen Umbauten
- Nur gezielte Verbesserungen

---

### ❗ Praxis vor Technik
- Lösungen müssen real im Alltag funktionieren
- Fokus auf:
  - Lagerprozesse
  - Gerätefluss
  - einfache Bedienung

---

### ❗ Weniger ist mehr (UX)
- keine unnötigen Felder
- keine komplexen Formulare
- einfache Buttons
- klare Abläufe

---

### ❗ Mobile Nutzung berücksichtigen
- Touch-Bedienung beachten
- große Klickflächen
- einfache Interaktion

---

## 🔐 Deployment-Regeln

### ❗ Wichtig
- KEINE Änderungen an:
  - Cloudflare
  - Runtime-Konfiguration
  - Secrets
  - produktiven Serverdateien

---

### 🛠 Workflow

Entwicklung:
- lokal in VS Code

Deployment:
```bash
git add .
git commit -m "..."
git push origin main