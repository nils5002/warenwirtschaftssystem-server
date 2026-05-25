export type UpdateNotes = {
  version: string;
  date?: string;
  title?: string;
  items: string[];
};

export const UPDATE_NOTES_STORAGE_KEY = 'wms.lastSeenUpdateVersion';

export const updateNotes = {
  version: "1.6.0",
  date: "2026-05-25",
  title: "Einsatzplanung mit echter Gerätezuordnung",
  items: [
    "Ausgegebene Geräte können jetzt direkt einer konkreten Einsatzplanung zugeordnet werden",
    "Verliehene Eigengeräte blockieren spätere Planungen nicht mehr dauerhaft, sondern nur noch im relevanten Ausgabezeitraum",
    "Die Einsatzplanung erkennt nun, wenn ausgegebene Geräte den geplanten Bedarf eines Projekts bereits erfüllen",
    "In der Detailansicht wird jetzt angezeigt, wie viele Geräte geplant und wie viele tatsächlich ausgegeben wurden",
    "Abweichungen werden pro Kategorie sichtbar, zum Beispiel „Passt“, „Mehr ausgegeben“ oder „Noch offen“",
    "Zugeordnete Geräte können in der Planung als konkrete Geräteliste eingesehen werden",
    "Alte Ausgaben können über ein geführtes Dry-Run-Skript sicher nachträglich mit einer Planung verknüpft werden"
  ]
};