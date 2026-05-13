export type UpdateNotes = {
  version: string;
  date: string;
  title: string;
  items: string[];
};

export const UPDATE_NOTES_STORAGE_KEY = 'wms.lastSeenUpdateVersion';

export const updateNotes: UpdateNotes = {
  version: '1..1',
  date: '2026-05-11',
  title: 'Neu in dieser Version',
  items: [
    "Kopfdaten bestehender Einsatzplanungen können nachträglich bearbeitet werden",
    "Kunde, Projekt und Veranstaltung lassen sich nun auch nach dem Anlegen korrigieren",
    "Änderungen an Planungsdaten werden direkt in Liste, Detailansicht und Planungskarte übernommen",
    "Kalenderwoche wurde aus der Einsatzplanung entfernt"
  ],
};
