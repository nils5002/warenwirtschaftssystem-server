export type UpdateNotes = {
  version: string;
  date: string;
  title: string;
  items: string[];
};

export const UPDATE_NOTES_STORAGE_KEY = 'wms.lastSeenUpdateVersion';

export const updateNotes = {
  version: "1.4.3",
  date: "2026-05-15",
  title: "Neu in dieser Version",
  items: [
    "Kategorien bleiben nach dem Neuladen der Seite erhalten",
    "Dropdown für Kategorien beim Anlegen neuer Hardware korrigiert",
    "Kategorien werden jetzt sauber aus dem System geladen und mit Standard-Kategorien ergänzt",
    "Einsatzplanung berücksichtigt Kartendrucker jetzt automatisch beim Laptop-Bedarf",
    "Verfügbarkeit und Konflikte in der Planung werden dadurch genauer berechnet",
    "Test ergänzt, um die Speicherung neuer Kategorien abzusichern"
  ]
};
