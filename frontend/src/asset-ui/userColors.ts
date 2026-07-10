// Signaturfarben pro Benutzer — Frontend-Spiegel der Backend-Palette
// (backend/app/domain/user_colors.py). Nur diese Werte akzeptiert die API.

export type SignatureColorOption = { value: string; label: string };

export const USER_SIGNATURE_COLORS: SignatureColorOption[] = [
  { value: '#7C3AED', label: 'Lila' },
  { value: '#2563EB', label: 'Blau' },
  { value: '#059669', label: 'Grün' },
  { value: '#D97706', label: 'Orange' },
  { value: '#DC2626', label: 'Rot' },
  { value: '#0891B2', label: 'Cyan' },
  { value: '#DB2777', label: 'Pink' },
  { value: '#65A30D', label: 'Lime' },
  { value: '#0F766E', label: 'Teal' },
  { value: '#9333EA', label: 'Violett' },
];

export function signatureColorLabel(value: string | null | undefined): string {
  const match = USER_SIGNATURE_COLORS.find(
    (option) => option.value.toUpperCase() === (value ?? '').toUpperCase(),
  );
  return match?.label ?? 'Farbe';
}

/** Initialen aus dem Anzeigenamen ("Nils Klemm" → "NK") — identisch zur
 *  Backend-Ableitung in planning_repository._user_initials. */
export function userInitials(name: string | null | undefined): string {
  const parts = (name ?? '').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '?';
}
