export type UpdateNotes = {
  version: string;
  date: string;
  title: string;
  items: string[];
};

export const UPDATE_NOTES_STORAGE_KEY = 'wms.lastSeenUpdateVersion';

export const updateNotes = {
  version: "1.5.0",
  date: "2026-05-17",
  title: "Verbesserte Einsatzplanung",
  items: [
    "Konflikte in der Einsatzplanung werden jetzt verständlicher nach Ursache und Schweregrad angezeigt",
    "Planungskarten zeigen nun Datum, Kategorie, Fehlmenge und Konfliktgrund kompakt an",
    "Die Detailansicht unterscheidet zwischen echten Engpässen, Übergabe-Prüfungen und Kompatibilitätsproblemen",
    "Die Konfliktberechnung selbst wurde nicht verändert; bestehende Konfliktzahlen bleiben konsistent"
  ]
};
