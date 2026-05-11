export type UpdateNotes = {
  version: string;
  date: string;
  title: string;
  items: string[];
};

export const UPDATE_NOTES_STORAGE_KEY = 'wms.lastSeenUpdateVersion';

export const updateNotes: UpdateNotes = {
  version: '1.1.0',
  date: '2026-05-11',
  title: 'Neu in dieser Version',
  items: [
    "Mehrere Geräte können nun nacheinander gescannt werden",
    "Die gescannten Geräte werden vor dem Abschluss übersichtlich angezeigt",
    "Ausgabe und Rücknahme können jetzt gesammelt abgeschlossen werden",
    "Die Einsatzplanung ist im Dark Mode jetzt besser lesbar",
    "Konflikte und Übergaben werden deutlicher hervorgehoben",
    "Projektinformationen wie Zeitraum, Status und Projektmanager sind klarer erkennbar"
  ],
};
