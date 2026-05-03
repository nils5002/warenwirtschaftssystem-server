# Contributing

Danke für deinen Beitrag zu diesem Repository.

## Branches
- Arbeite nach Möglichkeit in Feature-Branches, z. B. `feat/<thema>` oder `fix/<thema>`.
- `main` sollte jederzeit in einem lauffähigen Zustand bleiben.

## Commit-Nachrichten
- Verwende klare, kurze Commit-Messages.
- Empfehlung:
  - `feat: ...` für neue Funktionen
  - `fix: ...` für Fehlerbehebungen
  - `docs: ...` für Dokumentation
  - `chore: ...` für technische Pflege

## Lokale Checks vor Push
- Frontend-Build:
  - `npm --prefix frontend run build`
- Backend-Tests (je nach Änderung):
  - `cd backend`
  - `pytest`

## Pull Requests
- Problem und Lösung kurz beschreiben.
- Relevante Testausgaben oder Screenshots ergänzen (falls UI betroffen).
- Keine unnötig großen Diffs (keine massenhaften Formatierungsänderungen ohne Grund).

## Sicherheit
- Niemals Secrets, Tokens, private Schlüssel oder Passwörter committen.
- Keine produktiven `.env`-Dateien ins Repo aufnehmen.
- Vor Push prüfen, ob sensible Daten in Änderungen enthalten sind.
