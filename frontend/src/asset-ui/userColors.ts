// Signaturfarben pro Benutzer — Frontend-Spiegel der Backend-Palette
// (backend/app/domain/user_colors.py). Beide Listen führen dieselben
// Basiswerte (value = Border-/Akzentfarbe) in derselben Reihenfolge; nur
// diese Werte akzeptiert die API. `text` ist die hellere Dark-Mode-Variante
// für Initialen/Beschriftung, `bg` der transparente Flächenanteil.

export type SignatureColorOption = {
  /** Kanonischer Basiswert (Border/Akzent) — wird im Backend gespeichert. */
  value: string;
  label: string;
  /** Hellere Textfarbe für dunkle Flächen (Initialen im Dark Mode). */
  text: string;
};

export const USER_SIGNATURE_COLORS: SignatureColorOption[] = [
  // --- Bestandspalette (Reihenfolge nicht ändern) ---
  { value: '#7C3AED', label: 'Violett', text: '#A78BFA' },
  { value: '#2563EB', label: 'Königsblau', text: '#93C5FD' },
  { value: '#059669', label: 'Smaragd', text: '#34D399' },
  { value: '#D97706', label: 'Bernstein', text: '#FBBF24' },
  { value: '#DC2626', label: 'Rot', text: '#F87171' },
  { value: '#0891B2', label: 'Cyan', text: '#67E8F9' },
  { value: '#DB2777', label: 'Himbeer', text: '#F9A8D4' },
  { value: '#65A30D', label: 'Apfelgrün', text: '#BEF264' },
  { value: '#0F766E', label: 'Petrol', text: '#5EEAD4' },
  { value: '#9333EA', label: 'Purpur', text: '#D8B4FE' },
  // --- Erweiterung auf 30 (Farbfamilien bewusst gestreut) ---
  { value: '#3B82F6', label: 'Blau', text: '#60A5FA' },
  { value: '#F97316', label: 'Orange', text: '#FDBA74' },
  { value: '#14B8A6', label: 'Türkis', text: '#2DD4BF' },
  { value: '#EC4899', label: 'Pink', text: '#F472B6' },
  { value: '#84CC16', label: 'Limette', text: '#A3E635' },
  { value: '#6366F1', label: 'Indigo', text: '#A5B4FC' },
  { value: '#EAB308', label: 'Gelb', text: '#FACC15' },
  { value: '#F43F5E', label: 'Rose', text: '#FDA4AF' },
  { value: '#22C55E', label: 'Grün', text: '#4ADE80' },
  { value: '#C026D3', label: 'Fuchsia', text: '#E879F9' },
  { value: '#0EA5E9', label: 'Sky', text: '#38BDF8' },
  { value: '#C2410C', label: 'Kupfer', text: '#FB923C' },
  { value: '#BE123C', label: 'Weinrot', text: '#FB7185' },
  { value: '#4D7C0F', label: 'Moos', text: '#D9F99D' },
  { value: '#A855F7', label: 'Lila', text: '#C084FC' },
  { value: '#06B6D4', label: 'Aqua', text: '#22D3EE' },
  { value: '#D946EF', label: 'Magenta', text: '#F0ABFC' },
  { value: '#64748B', label: 'Schiefer', text: '#CBD5E1' },
  { value: '#FB7185', label: 'Koralle', text: '#FDA4AF' },
  { value: '#2DD4BF', label: 'Mint', text: '#99F6E4' },
];

export type SignatureVisual = {
  name: string;
  /** Akzent-/Randfarbe (Kalender-Streifen, Marker) — der gespeicherte Wert. */
  border: string;
  /** Transparente Fläche für Badges/Chips (Hex + 18% Alpha). */
  bg: string;
  /** Text im Light Mode (Basiston — lesbar auf heller Tint-Fläche). */
  text: string;
  /** Text im Dark Mode (hellere Variante — lesbar auf dunkler Fläche). */
  textDark: string;
};

/**
 * Zentrale Farbauflösung: gespeicherter Hexwert → Anzeige-Varianten.
 * Unbekannte Werte (Altbestand außerhalb der Palette) fallen sauber auf
 * abgeleitete Varianten zurück, ungültige auf neutrales Grau.
 */
export function resolveSignatureVisual(value: string | null | undefined): SignatureVisual {
  const candidate = (value ?? '').trim();
  const normalized = candidate.toUpperCase();
  const match = USER_SIGNATURE_COLORS.find((option) => option.value.toUpperCase() === normalized);
  if (match) {
    return {
      name: match.label,
      border: match.value,
      bg: `${match.value}2E`,
      text: match.value,
      textDark: match.text,
    };
  }
  if (/^#[0-9A-F]{6}$/.test(normalized)) {
    return { name: 'Farbe', border: candidate, bg: `${candidate}2E`, text: candidate, textDark: candidate };
  }
  return { name: 'Neutral', border: '#64748B', bg: '#64748B2E', text: '#64748B', textDark: '#CBD5E1' };
}

export function signatureColorLabel(value: string | null | undefined): string {
  return resolveSignatureVisual(value).name;
}

/** Initialen aus dem Anzeigenamen ("Nils Klemm" → "NK") — identisch zur
 *  Backend-Ableitung in planning_repository._user_initials. */
export function userInitials(name: string | null | undefined): string {
  const parts = (name ?? '').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return '?';
}
