# Refactoring Status (2026-04-17)

## 1) Analyse des aktuellen Stands

Bereits umgesetzt:
- Backend ist in Layer getrennt: `routes`, `services`, `repositories`, `schemas`, `database`, `config`.
- `main.py` ist jetzt schlank und nutzt App-Factory (`create_app()`).
- WMS-Endpunkte `/api/wms/*` laufen ueber SQLAlchemy-DB-Repository (`wms_repository`) statt JSON-Store.
- Legacy-JSON ist nur noch Seed-Quelle beim Startup.
- Alembic ist eingerichtet (`backend/alembic`, `backend/alembic.ini`, Initial-Migration vorhanden).
- Frontend-Logik aus `App.tsx` in Hook/Services/Component ausgelagert.
- Fallback-Demo-Daten aus `App.tsx` entfernt.

Noch bewusst als Legacy erhalten:
- `backend/app/services/wms_store.py` (klar markiert als legacy).
- Kompatibilitaetsmodule `backend/app/models.py` und `backend/app/wms_models.py` (re-export auf neue Schemas).
- `frontend/src/asset-ui/api.ts` als Re-Export auf `src/services/wmsApi.ts`.

## 2) Zielstruktur (erreicht)

```text
cloud_web/
├── backend/
│   ├── alembic/
│   ├── alembic.ini
│   ├── app/
│   │   ├── config/
│   │   ├── database/
│   │   ├── repositories/
│   │   ├── routes/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── errors.py
│   │   └── main.py
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── components/
│       ├── config/
│       ├── hooks/
│       ├── services/
│       └── asset-ui/
├── .env.example
└── docker-compose.yml
```

## 3) Prioritaeten

Sofort:
1. Dependencies installieren: `pip install -r backend/requirements.txt`
2. Alembic Migration laufen lassen: `cd backend && alembic upgrade head`
3. Backend starten und `/api/wms/overview` sowie `/api/db/assets` testen.

Als naechstes:
1. Legacy-Kompatibilitaetsmodule (`app/models.py`, `app/wms_models.py`) schrittweise entfernen.
2. `wms_store.py` nach finaler Stabilisierung loeschen.
3. API-Contract-Tests fuer `/api/wms/*` und `/api/db/assets` ergaenzen.
4. API-Contract-Tests fuer `/api/import/hardware*` ergaenzen.

## 4) JSON -> DB Migrationsstrategie (ohne Endpoint-Bruch)

Phase A (done):
- DB-Schema eingefuehrt.
- `/api/wms/*` auf DB umgestellt.
- Legacy JSON nur fuer initialen Import (`WMS_SEED_LEGACY_ON_STARTUP`).

Phase B:
- Produktion: Seed-Flag auf `false`, sobald Daten final in DB liegen.
- JSON-Datei nur noch als Archiv/Backup behalten.

Phase C:
- Legacy-Store und Kompatibilitaetsmodule entfernen.
- Nur noch DB als Source of Truth.

## 5) Erweiterung Hardware-Excel-Import (neu)

Umgesetzt:
- Importpfad zentral ueber `HARDWARE_IMPORT_PATH` in Settings.
- Pipeline eingefuehrt:
  - `services/hardware_import/parser.py`
  - `services/hardware_import/validator.py`
  - `services/hardware_import/mapper.py`
  - `services/hardware_import/importer.py`
  - Orchestrierung in `services/excel_import_service.py`
- API-Endpunkte:
  - `POST /api/import/hardware`
  - `GET /api/import/hardware/{run_id}`
- Import-Logs in DB:
  - `hardware_import_runs`
  - `hardware_import_row_errors`
- Alembic-Migration fuer neue Felder/Tabellen:
  - `20260417_0002_hardware_import_columns_and_logs.py`
- Docker-Anbindung fuer Import-Ordner:
  - `./Hardwarebestand:/app/data/hardware_imports:ro`

Noch offen:
1. Optionaler Background-Job fuer asynchronen Import bei sehr grossen Dateien.
2. Optionales UI fuer Run-Historie und Fehlerdownload.
3. Optionales Mapping-Profil pro Lieferant/Dateityp.
